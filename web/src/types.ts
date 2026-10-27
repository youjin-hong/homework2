export type Job = {
  id: number
  type: string
  status: 'queued' | 'started' | 'completed' | 'failed'
  workerId: string | null
  message: string | null
  createdAt: string
}
