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
  const { data } = useQuery({ queryKey: STATUS_KEY, queryFn: fetchStatus, refetchInterval: 3000 })

  const doneMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/review-done', { method: 'POST' })
      return res.json() as Promise<ReviewStatus>
    },
    onSuccess: (status) => {
      queryClient.setQueryData<ReviewStatus>(STATUS_KEY, status)
    },
  })

  const closeReview = async () => {
    await fetch('/api/shutdown', { method: 'POST' })
  }

  return {
    reviewDone: data?.reviewDone ?? false,
    openComments: data?.openComments ?? 0,
    markDone: doneMutation.mutateAsync,
    closeReview,
  }
}
