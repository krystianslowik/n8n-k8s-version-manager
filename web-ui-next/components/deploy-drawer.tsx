'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { formatMemory, formatAge } from '@/lib/format'
import { addActivity } from '@/lib/activity'
import {
  useAvailableVersions,
  useClusterResources,
  useSnapshots,
  useDeployVersion,
  grpcQueryKeys,
} from '@/lib/grpc-hooks'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  RocketIcon,
  LayersIcon,
  ZapIcon,
  LoaderIcon,
  ChevronsUpDownIcon,
  CheckIcon,
  ExternalLinkIcon,
  AlertTriangleIcon,
  SettingsIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/lib/hooks'
import { HelmValuesEditor } from '@/components/helm-values-editor'
import { RefreshButton } from '@/components/refresh-button'
import type { HelmValues } from '@/lib/types'

interface DeployDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeployDrawer({ open, onOpenChange }: DeployDrawerProps) {
  const [version, setVersion] = useState('')
  const [mode, setMode] = useState<'queue' | 'regular'>('queue')
  const [snapshot, setSnapshot] = useState('')
  const [versionPopoverOpen, setVersionPopoverOpen] = useState(false)
  const [snapshotPopoverOpen, setSnapshotPopoverOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [helmValues, setHelmValues] = useState<HelmValues>({})

  const debouncedSearch = useDebounce(searchQuery, 300)

  const queryClient = useQueryClient()

  // Data is prefetched on page load, so it should be immediately available
  const { data: availableVersionsData, isLoading: isLoadingVersions, isFetching: isFetchingVersions, refetch: refetchVersions } = useAvailableVersions({
    staleTime: 6 * 60 * 60 * 1000, // 6 hours
  })

  // Map proto versions to simple string array
  const availableVersions = useMemo(() => {
    return availableVersionsData?.map(v => v.version) || []
  }, [availableVersionsData])

  const { data: clusterResources } = useClusterResources({
    staleTime: 15_000,
    refetchInterval: open ? 15_000 : false, // Only poll while drawer is open
  })

  // Data is prefetched on page load - filter for named snapshots
  const { data: allSnapshots, isLoading: isLoadingSnapshots } = useSnapshots({
    staleTime: 30_000,
  })

  // Filter for named snapshots (those with sourceNamespace set)
  const namedSnapshots = useMemo(() => {
    return allSnapshots?.filter(s => s.sourceNamespace) || []
  }, [allSnapshots])

  // Deploy with streaming progress
  const { deploy, isDeploying, progress } = useDeployVersion({
    onProgress: (p) => {
      if (p.message) {
        toast.loading(p.message, { id: 'deploy-progress', description: undefined })
      }
    },
    onSuccess: (namespace) => {
      toast.success('Deployment complete', { id: 'deploy-progress', description: undefined })
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })
      addActivity('deployed', `v${version}`)
      onOpenChange(false)
      setVersion('')
      setHelmValues({})
    },
    onError: (error) => {
      toast.error('Deployment failed', {
        id: 'deploy-progress',
        description: error.message,
      })
    },
  })

  const QUEUE_MODE_MEMORY = 1792
  const REGULAR_MODE_MEMORY = 512

  const requiredMemory = mode === 'queue' ? QUEUE_MODE_MEMORY : REGULAR_MODE_MEMORY
  const summary = clusterResources?.summary

  // Parse memory strings (e.g., "16Gi", "1234Mi") to Mi
  const parseMemoryToMi = (memStr: string | undefined): number => {
    if (!memStr) return 0
    const match = memStr.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti)?$/i)
    if (!match) return 0
    const value = parseFloat(match[1])
    const unit = (match[2] || '').toLowerCase()
    switch (unit) {
      case 'ki': return value / 1024
      case 'mi': return value
      case 'gi': return value * 1024
      case 'ti': return value * 1024 * 1024
      default: return value / (1024 * 1024)
    }
  }

  const totalMemoryMi = parseMemoryToMi(summary?.totalMemory)
  const usedMemoryMi = parseMemoryToMi(summary?.usedMemory)
  const availableMemory = totalMemoryMi - usedMemoryMi
  const hasCapacity = availableMemory >= requiredMemory

  const filteredVersions = useMemo(() => {
    if (!availableVersions) return []
    if (!debouncedSearch) return availableVersions
    return availableVersions.filter((v) =>
      v.toLowerCase().includes(debouncedSearch.toLowerCase())
    )
  }, [availableVersions, debouncedSearch])

  // Helper to detect pre-release versions (contains - like 1.92.0-beta.1)
  const isPrerelease = (version: string) => version.includes('-')

  // Split versions into stable and pre-release groups
  const { stableVersions, prereleaseVersions } = useMemo(() => {
    const stable: string[] = []
    const prerelease: string[] = []

    filteredVersions.forEach((v) => {
      if (isPrerelease(v)) {
        prerelease.push(v)
      } else {
        stable.push(v)
      }
    })

    return { stableVersions: stable, prereleaseVersions: prerelease }
  }, [filteredVersions])

  const isSearching = searchQuery !== debouncedSearch

  const handleDeploy = () => {
    if (!version) {
      toast.error('Version required', {
        description: 'Please enter a version number',
      })
      return
    }

    // Note: helm_values not yet supported in gRPC, will need to add to proto
    deploy({
      version,
      mode,
      snapshot: snapshot || undefined,
    })
  }

  return (
    <Drawer open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        // Reset form state when drawer closes
        setVersion('')
        setMode('queue')
        setSnapshot('')
        setHelmValues({})
      }
      onOpenChange(isOpen)
    }}>
      <DrawerContent className="max-w-2xl mx-auto">
        <DrawerHeader>
          <DrawerTitle>Deploy New Version</DrawerTitle>
          <DrawerDescription>
            Configure and deploy a new n8n instance
          </DrawerDescription>
        </DrawerHeader>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
          {/* Essential Settings */}
          <Card className="border-dashed">
            <CardContent className="pt-4 space-y-4">
              {/* Version Selection */}
              <div className="space-y-2">
            <Label>Version</Label>
            <div className="flex gap-2">
              <Popover open={versionPopoverOpen} onOpenChange={setVersionPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={versionPopoverOpen}
                    className="flex-1 justify-between"
                  >
                    {version || 'Select version...'}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Search versions..."
                      value={searchQuery}
                      onValueChange={setSearchQuery}
                    />
                    <CommandList>
                      {isLoadingVersions || isSearching ? (
                        <div className="p-4 space-y-2">
                          {Array(4)
                            .fill(0)
                            .map((_, i) => (
                              <Skeleton key={i} className="h-8 w-full" />
                            ))}
                        </div>
                      ) : filteredVersions.length === 0 ? (
                        <CommandEmpty>No version found.</CommandEmpty>
                      ) : (
                        <>
                          {prereleaseVersions.length > 0 && (
                            <CommandGroup heading="Pre-releases">
                              {prereleaseVersions.map((v) => (
                                <CommandItem
                                  key={v}
                                  value={v}
                                  onSelect={(currentValue) => {
                                    setVersion(currentValue)
                                    setVersionPopoverOpen(false)
                                    setSearchQuery('')
                                  }}
                                >
                                  <CheckIcon
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      version === v ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  <span className="flex-1">{v}</span>
                                  <a
                                    href={`https://github.com/n8n-io/n8n/releases/tag/n8n@${v}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLinkIcon className="h-3 w-3" />
                                  </a>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                          {stableVersions.length > 0 && (
                            <CommandGroup heading="Stable Releases">
                              {stableVersions.map((v) => (
                                <CommandItem
                                  key={v}
                                  value={v}
                                  onSelect={(currentValue) => {
                                    setVersion(currentValue)
                                    setVersionPopoverOpen(false)
                                    setSearchQuery('')
                                  }}
                                >
                                  <CheckIcon
                                    className={cn(
                                      'mr-2 h-4 w-4',
                                      version === v ? 'opacity-100' : 'opacity-0'
                                    )}
                                  />
                                  <span className="flex-1">{v}</span>
                                  <a
                                    href={`https://github.com/n8n-io/n8n/releases/tag/n8n@${v}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <ExternalLinkIcon className="h-3 w-3" />
                                  </a>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <RefreshButton
                onClick={() => refetchVersions()}
                isLoading={isFetchingVersions}
                variant="outline"
                size="sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Search or select from all available releases
            </p>
          </div>

          {/* Quick Select Badges */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Quick Select
            </Label>
            <div className="flex gap-2 flex-wrap">
              {isLoadingVersions ? (
                Array(5)
                  .fill(0)
                  .map((_, i) => <Skeleton key={i} className="h-6 w-16" />)
              ) : (
                availableVersions?.slice(0, 5).map((v) => (
                  <Badge
                    key={v}
                    variant={version === v ? 'default' : 'outline'}
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all"
                    onClick={() => setVersion(v)}
                  >
                    {v}
                  </Badge>
                ))
              )}
            </div>
          </div>

          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="flex gap-2">
              <Button
                variant={mode === 'queue' ? 'default' : 'outline'}
                onClick={() => setMode('queue')}
                className="flex-1"
              >
                <LayersIcon className="h-4 w-4 mr-2" />
                Queue
              </Button>
              <Button
                variant={mode === 'regular' ? 'default' : 'outline'}
                onClick={() => setMode('regular')}
                className="flex-1"
              >
                <ZapIcon className="h-4 w-4 mr-2" />
                Regular
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Queue mode runs separate worker processes
            </p>
          </div>

          {/* Initial Data Selection */}
          <div className="space-y-2">
            <Label>Initial Data</Label>
              <Popover open={snapshotPopoverOpen} onOpenChange={setSnapshotPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={snapshotPopoverOpen}
                    className="w-full justify-between"
                  >
                    {snapshot || 'Select snapshot...'}
                    <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search snapshots..." />
                    <CommandList>
                      {isLoadingSnapshots ? (
                        <div className="p-4 space-y-2">
                          {Array(3)
                            .fill(0)
                            .map((_, i) => (
                              <Skeleton key={i} className="h-8 w-full" />
                            ))}
                        </div>
                      ) : !namedSnapshots || namedSnapshots.length === 0 ? (
                        <CommandEmpty>No snapshots available.</CommandEmpty>
                      ) : (
                        <CommandGroup>
                          <CommandItem
                            value=""
                            onSelect={() => {
                              setSnapshot('')
                              setSnapshotPopoverOpen(false)
                            }}
                          >
                            <CheckIcon
                              className={cn(
                                'mr-2 h-4 w-4',
                                !snapshot ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            None (fresh database)
                          </CommandItem>
                          {namedSnapshots.map((s) => (
                            <CommandItem
                              key={s.name}
                              value={s.name}
                              onSelect={() => {
                                setSnapshot(s.name)
                                setSnapshotPopoverOpen(false)
                              }}
                            >
                              <CheckIcon
                                className={cn(
                                  'mr-2 h-4 w-4',
                                  snapshot === s.name ? 'opacity-100' : 'opacity-0'
                                )}
                              />
                              {s.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            <p className="text-xs text-muted-foreground">
              Select a snapshot to initialize the database with existing data
            </p>
              </div>
            </CardContent>
          </Card>

          {/* Configuration - Collapsible Accordion */}
          <Accordion type="single" collapsible className="border-t pt-2">
            <AccordionItem value="config" className="border-none">
              <AccordionTrigger className="py-3 hover:no-underline">
                <div className="flex items-center gap-2">
                  <SettingsIcon className="h-4 w-4" />
                  <span className="text-sm font-medium">Advanced Configuration</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-2 pb-0">
                <HelmValuesEditor
                  value={helmValues}
                  onChange={setHelmValues}
                  isQueueMode={mode === 'queue'}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>

        {/* Capacity Warning */}
        {summary && !hasCapacity && (
          <div className="px-6 pb-4">
            <div className="border-2 border-red-200 rounded-lg p-4 bg-red-50 max-h-96 overflow-y-auto">
              <div className="flex items-start gap-3">
                <AlertTriangleIcon className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 space-y-2 min-w-0">
                  <div>
                    <p className="font-semibold text-red-900">
                      Insufficient Memory
                    </p>
                    <p className="text-sm text-red-700 mt-1">
                      This {mode} mode deployment needs {formatMemory(requiredMemory)}, but only {formatMemory(availableMemory)} is available.
                    </p>
                  </div>
                  <p className="text-xs text-red-700 mt-2">
                    Go to the dashboard to delete deployments and free up memory.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DrawerFooter>
          <Button
            onClick={handleDeploy}
            disabled={isDeploying || !version || !hasCapacity}
            className="w-full"
          >
            {isDeploying ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                {progress?.message || 'Deploying...'}
              </>
            ) : (
              <>
                <RocketIcon className="h-4 w-4 mr-2" />
                Deploy
              </>
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
