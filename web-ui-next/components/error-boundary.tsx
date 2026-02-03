'use client'

import { Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, RefreshCwIcon } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-destructive/5">
          <AlertCircleIcon className="h-10 w-10 text-destructive mb-4" />
          <h3 className="font-semibold text-lg mb-2">Something went wrong</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md">
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button onClick={this.handleReset} variant="outline">
            <RefreshCwIcon className="h-4 w-4 mr-2" />
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

interface QueryErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function QueryErrorState({ message = 'Failed to load data', onRetry }: QueryErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <AlertCircleIcon className="h-8 w-8 text-destructive mb-3" />
      <p className="text-sm text-muted-foreground mb-3">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm">
          <RefreshCwIcon className="h-4 w-4 mr-2" />
          Retry
        </Button>
      )}
    </div>
  )
}
