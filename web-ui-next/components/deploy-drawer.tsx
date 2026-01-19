'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  RocketIcon,
  SearchIcon,
  ChevronRightIcon,
  LayersIcon,
  ZapIcon,
  LoaderIcon,
} from 'lucide-react'
import { toast } from 'sonner'

interface DeployDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeployDrawer({ open, onOpenChange }: DeployDrawerProps) {
  const [version, setVersion] = useState('')
  const [customName, setCustomName] = useState('')
  const [nameError, setNameError] = useState('')
  const [mode, setMode] = useState<'queue' | 'regular'>('queue')
  const [isolatedDb, setIsolatedDb] = useState(false)

  const queryClient = useQueryClient()

  const { data: availableVersions, isLoading: isLoadingVersions } = useQuery({
    queryKey: ['available-versions'],
    queryFn: api.getAvailableVersions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const deployMutation = useMutation({
    mutationFn: api.deployVersion,
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Deployment started', {
          description: `n8n ${version} is being deployed`,
        })
        onOpenChange(false)
        setVersion('')
        setCustomName('')
        queryClient.invalidateQueries({ queryKey: ['deployments'] })
      } else {
        toast.error('Deployment failed', {
          description: data.error || 'Unknown error',
        })
      }
    },
    onError: (error: Error) => {
      toast.error('Deployment failed', {
        description: error.message,
      })
    },
  })

  const validateName = (value: string) => {
    if (!value) {
      setNameError('')
      return true
    }

    const valid =
      /^[a-z0-9-]+$/.test(value) &&
      value.length <= 63 &&
      /^[a-z0-9]/.test(value) &&
      /[a-z0-9]$/.test(value)

    if (!valid) {
      setNameError(
        'Must be lowercase alphanumeric + hyphens, max 63 chars, start/end with alphanumeric'
      )
      return false
    }

    setNameError('')
    return true
  }

  const handleDeploy = () => {
    if (!version) {
      toast.error('Version required', {
        description: 'Please enter a version number',
      })
      return
    }

    if (customName && !validateName(customName)) {
      toast.error('Invalid name', {
        description: 'Please fix the custom name validation errors',
      })
      return
    }

    deployMutation.mutate({
      version,
      mode,
      isolated_db: isolatedDb,
      name: customName || undefined,
    })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl mx-auto">
        <DrawerHeader>
          <DrawerTitle>Deploy New Version</DrawerTitle>
          <DrawerDescription>
            Configure and deploy a new n8n instance
          </DrawerDescription>
        </DrawerHeader>

        <div className="p-6 space-y-6">
          {/* GitHub Version Quick-Select */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Recent Versions
            </Label>
            <div className="flex gap-2 flex-wrap">
              {isLoadingVersions ? (
                Array(6)
                  .fill(0)
                  .map((_, i) => <Skeleton key={i} className="h-8 w-20" />)
              ) : (
                availableVersions?.slice(0, 8).map((v) => (
                  <Badge
                    key={v}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all"
                    onClick={() => setVersion(v)}
                  >
                    {v}
                  </Badge>
                ))
              )}
            </div>
          </div>

          {/* Version Input */}
          <div className="space-y-2">
            <Label htmlFor="version">Version</Label>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="version"
                placeholder="1.90.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Or select from recent releases above
            </p>
          </div>

          {/* Advanced Options (Collapsible) */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm hover:underline">
              <ChevronRightIcon className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
              Advanced Options
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customName">Custom Name (optional)</Label>
                <Input
                  id="customName"
                  placeholder="my-custom-deployment"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value)
                    validateName(e.target.value)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for auto-generated name (n8n-v
                  {version.replace(/\./g, '-') || '{version}'})
                </p>
                {nameError && (
                  <p className="text-xs text-destructive">{nameError}</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

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

          {/* Isolated DB Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isolatedDb"
              checked={isolatedDb}
              onCheckedChange={(checked) => setIsolatedDb(checked as boolean)}
            />
            <Label htmlFor="isolatedDb" className="cursor-pointer">
              Use isolated database (experimental)
            </Label>
          </div>
        </div>

        <DrawerFooter>
          <Button
            onClick={handleDeploy}
            disabled={deployMutation.isPending || !version}
            className="w-full"
          >
            {deployMutation.isPending ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                Deploying...
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
