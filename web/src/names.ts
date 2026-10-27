// 화면에서만 쓰는 이름표 (코드와 WORKER_ID는 worker-1~3 그대로)
export const MANAGER = { name: '은지원', role: '홀 매니저', face: '🧑‍💼' }

export const CHEFS = [
  { workerId: 'worker-1', name: '강호동', face: '🧑‍🍳' },
  { workerId: 'worker-2', name: '이수근', face: '🧑‍🍳' },
  { workerId: 'worker-3', name: '안재현', face: '🧑‍🍳' },
]

export function chefName(workerId: string | null) {
  if (!workerId) return null
  return CHEFS.find((chef) => chef.workerId === workerId)?.name ?? workerId
}
