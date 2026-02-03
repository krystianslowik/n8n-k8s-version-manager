/**
 * REST API client - retained only for file uploads
 * All other API calls use gRPC via grpc-hooks.ts
 */

import type { SnapshotActionResponse } from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const api = {
  /**
   * Upload a snapshot file via multipart form data
   * Note: File uploads require REST/multipart, not suitable for gRPC
   */
  async uploadSnapshot(file: File, name: string): Promise<SnapshotActionResponse> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', name)

    const response = await fetch(`${API_URL}/api/snapshots/upload`, {
      method: 'POST',
      body: formData,
      // Don't set Content-Type header - browser sets it with boundary for multipart
    })

    if (!response.ok) {
      let errorMessage = response.statusText
      try {
        const errorBody = await response.json()
        if (errorBody.detail) {
          errorMessage = typeof errorBody.detail === 'string'
            ? errorBody.detail
            : errorBody.detail[0]?.msg || response.statusText
        }
      } catch {
        // Use statusText if body can't be parsed
      }
      throw new Error(errorMessage)
    }

    return response.json()
  },
}
