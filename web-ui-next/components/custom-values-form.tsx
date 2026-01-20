'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { PlusIcon, XIcon, ChevronRightIcon, CodeIcon } from 'lucide-react'
import type { CustomValues, EnvVar } from '@/lib/types'

interface CustomValuesFormProps {
  value: CustomValues
  onChange: (value: CustomValues) => void
  isQueueMode: boolean
}

export function CustomValuesForm({ value, onChange, isQueueMode }: CustomValuesFormProps) {
  const [rawYamlOpen, setRawYamlOpen] = useState(false)

  const envVars = value.envVars || []

  const addEnvVar = () => {
    onChange({
      ...value,
      envVars: [...envVars, { key: '', value: '' }],
    })
  }

  const updateEnvVar = (index: number, field: 'key' | 'value', newValue: string) => {
    const updated = [...envVars]
    updated[index] = { ...updated[index], [field]: newValue }
    onChange({ ...value, envVars: updated })
  }

  const removeEnvVar = (index: number) => {
    onChange({
      ...value,
      envVars: envVars.filter((_, i) => i !== index),
    })
  }

  const updateResources = (field: 'cpu' | 'memory', newValue: string) => {
    onChange({
      ...value,
      resources: {
        ...value.resources,
        [field]: newValue || undefined,
      },
    })
  }

  const updateWorkerReplicas = (newValue: string) => {
    const num = parseInt(newValue, 10)
    onChange({
      ...value,
      workerReplicas: isNaN(num) ? undefined : num,
    })
  }

  const updateRawYaml = (newValue: string) => {
    onChange({
      ...value,
      rawYaml: newValue || undefined,
    })
  }

  return (
    <div className="space-y-4">
      {/* Environment Variables */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Environment Variables</Label>
        <div className="space-y-2">
          {envVars.map((env, index) => (
            <div key={index} className="flex gap-2">
              <Input
                placeholder="N8N_LOG_LEVEL"
                value={env.key}
                onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Input
                placeholder="debug"
                value={env.value}
                onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeEnvVar(index)}
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addEnvVar}
            className="w-full"
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            Add Variable
          </Button>
        </div>
      </div>

      {/* Resources */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Resource Limits</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">CPU Limit</Label>
            <Input
              placeholder="1000m"
              value={value.resources?.cpu || ''}
              onChange={(e) => updateResources('cpu', e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Memory Limit</Label>
            <Input
              placeholder="2Gi"
              value={value.resources?.memory || ''}
              onChange={(e) => updateResources('memory', e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>
      </div>

      {/* Worker Replicas (queue mode only) */}
      {isQueueMode && (
        <div className="space-y-2">
          <Label className="text-sm font-medium">Worker Replicas</Label>
          <Input
            type="number"
            min="1"
            max="10"
            placeholder="2"
            value={value.workerReplicas ?? ''}
            onChange={(e) => updateWorkerReplicas(e.target.value)}
            className="w-24 font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Number of worker pods (default: 2)
          </p>
        </div>
      )}

      {/* Raw YAML Override */}
      <Collapsible open={rawYamlOpen} onOpenChange={setRawYamlOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm hover:underline">
          <ChevronRightIcon className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
          <CodeIcon className="h-4 w-4" />
          Raw YAML Override (Advanced)
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <Textarea
            placeholder={`# Override any Helm value\nn8nConfig:\n  timezone: "Europe/London"\ndatabase:\n  shared:\n    host: "custom-db.example.com"`}
            value={value.rawYaml || ''}
            onChange={(e) => updateRawYaml(e.target.value)}
            className="font-mono text-sm min-h-[120px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Raw YAML values merged with form settings (raw takes precedence)
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
