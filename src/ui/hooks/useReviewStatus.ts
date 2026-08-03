import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

const STATUS_KEY = ['review-status']

interface ReviewStatus {
  reviewDone: boolean
  openComments: number
}

async function fetchStatus(): Promise<ReviewStatus> {
  const res = await fetch('/api/status')
  return res.json()
}

export function useReviewStatus() {
  const queryClient = useQueryClient()
  // The server stops as soon as the review is handed off, so this is remembered locally
  // rather than read back, and polling stops with it.
  const [closed, setClosed] = useState(false)
  const { data } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: fetchStatus,
    refetchInterval: closed ? false : 3000,
    enabled: !closed,
  })

  const doneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/review-done', { method: 'POST' })
      return res.json() as Promise<ReviewStatus>
    },
    onSuccess: (status) => {
      queryClient.setQueryData<ReviewStatus>(STATUS_KEY, status)
      setClosed(true)
    },
  })

  return {
    reviewDone: closed || (data?.reviewDone ?? false),
    openComments: data?.openComments ?? 0,
    markDone: doneMutation.mutateAsync,
  }
}
