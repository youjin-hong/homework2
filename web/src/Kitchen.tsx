import { LayoutGroup, motion } from 'motion/react'
import type { Job } from './types'

// 요리사 이름은 화면에서만 매핑한다
const CHEFS = [
  { workerId: 'worker-1', name: '요리사1', face: '👨‍🍳' },
  { workerId: 'worker-2', name: '요리사2', face: '🧑‍🍳' },
  { workerId: 'worker-3', name: '요리사3', face: '👩‍🍳' },
]

const MENU_ICON: Record<string, string> = { 라면: '🍜', 돈까스: '🥩', 김치볶음밥: '🍛' }

function Ticket({ job }: { job: Job }) {
  const icon = job.status === 'failed' ? '❌' : job.status === 'completed' ? '✅' : MENU_ICON[job.menu] ?? '🍽️'
  return (
    <motion.div layout layoutId={`job-${job.id}`} className={`ticket ticket-${job.status}`}>
      <span>{icon}</span>
      <span>{job.id}</span>
    </motion.div>
  )
}

export default function Kitchen({ jobs }: { jobs: Job[] }) {
  const queued = jobs.filter((j) => j.status === 'queued').reverse()
  const done = jobs.filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 8)
  const cooking = (workerId: string) => jobs.find((j) => j.status === 'started' && j.workerId === workerId)

  return (
    <LayoutGroup>
      <section className="kitchen">
        <div className="zone">
          <h3>주문 꽂이</h3>
          <div className="tickets">
            {queued.map((job) => (
              <Ticket key={job.id} job={job} />
            ))}
          </div>
        </div>

        <div className="zone stove">
          <h3>주방</h3>
          {CHEFS.map((chef) => {
            const job = cooking(chef.workerId)
            return (
              <div key={chef.workerId} className="chef-row">
                <span className={job ? 'chef cooking' : 'chef'}>{chef.face}</span>
                <span className="chef-name">{chef.name}</span>
                <div className="chef-slot">
                  {job ? <Ticket job={job} /> : <span className="idle">쉬는 중</span>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="zone">
          <h3>완성 카운터</h3>
          <div className="tickets">
            {done.map((job) => (
              <Ticket key={job.id} job={job} />
            ))}
          </div>
        </div>
      </section>
    </LayoutGroup>
  )
}
