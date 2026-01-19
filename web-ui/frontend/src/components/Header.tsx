import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Badge } from './ui/badge'

export function Header() {
  const { data: infrastructure } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: api.getInfrastructureStatus,
    refetchInterval: 5000, // Poll every 5 seconds
  })

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            n8n Version Manager
          </h1>
          <p className="text-gray-600 mt-1">
            Quick version switching for local Kubernetes
          </p>
        </div>

        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Postgres:</span>
            <Badge variant={infrastructure?.postgres.healthy ? 'default' : 'destructive'}>
              {infrastructure?.postgres.healthy ? '✓' : '✗'}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Redis:</span>
            <Badge variant={infrastructure?.redis.healthy ? 'default' : 'destructive'}>
              {infrastructure?.redis.healthy ? '✓' : '✗'}
            </Badge>
          </div>
        </div>
      </div>

      {infrastructure && (!infrastructure.postgres.healthy || !infrastructure.redis.healthy) && (
        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-sm text-yellow-800">
            ⚠️ Infrastructure unavailable. Postgres or Redis not ready.
          </p>
        </div>
      )}
    </div>
  )
}
