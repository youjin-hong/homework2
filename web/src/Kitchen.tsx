import type { ReactNode } from 'react'
import { LayoutGroup, motion } from 'motion/react'
import { CHEFS, MANAGER } from './names'
import type { Job } from './types'

const MENU_ICON: Record<string, string> = { 라면: '🍜', 돈까스: '🥩', 김치볶음밥: '🍛' }

function Ticket({ job }: { job: Job }) {
  const icon = job.status === 'failed' ? '❌' : job.status === 'completed' ? '✅' : MENU_ICON[job.menu] ?? '🍽️'
  return (
    <motion.div
      layout
      layoutId={`job-${job.id}`}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`ticket ticket-${job.status}`}
    >
      <span>{icon}</span>
      <span>{job.id}</span>
    </motion.div>
  )
}

const ROLES = [
  ['React', '손님이 보는 화면. 주문 버튼을 누르고, 1초마다 상태를 물어봄(Polling)'],
  ['nginx', '가게 입구 안내. 화면 파일을 주고 /api 요청을 마스터로 넘김'],
  ['마스터', '주문을 DB에 적고 jobs 큐에 발행(Producer). 워커의 결과 이벤트를 받아 DB를 갱신(Consumer)'],
  ['워커', 'jobs 큐에서 주문을 받아 조리(Consumer). 결과를 job.events 큐에 발행(Producer)'],
  ['RabbitMQ', '메시지 브로커. jobs 큐(주문표 꽂이)와 job.events 큐(결과 알림)를 보관'],
  ['DB (MySQL)', '주문 장부. 마스터만 읽고 씀'],
  ['수동 Ack', '워커가 결과 이벤트 전달을 확인한 뒤에만 보내는 처리 완료 신호. 그 전에 쓰러지면 주문표가 꽂이로 돌아감'],
  ['prefetch=1', '요리사는 주문표를 한 장씩만 집음. 일이 끝난 요리사가 다음 장을 가져감'],
]

type Props = {
  jobs: Job[]
  // 은지원이 방금 접수한 주문 (잠깐만 홀 매니저 자리에 보인다)
  receivingId: number | null
  // 쓰러진 요리사 (workerId별)
  fallen: Record<string, boolean>
  onCrash: (workerId: string) => void
  orderPanel: ReactNode
}

export default function Kitchen({ jobs, receivingId, fallen, onCrash, orderPanel }: Props) {
  const receiving = jobs.find((j) => j.id === receivingId)
  const rest = jobs.filter((j) => j.id !== receivingId)
  // 쓰러진 요리사가 들고 있던 주문은 브로커에서 다시 대기열로 돌아간다
  const dropped = rest.filter((j) => j.status === 'started' && j.workerId !== null && fallen[j.workerId])
  const queued = [...dropped, ...rest.filter((j) => j.status === 'queued').reverse()]
  const done = rest.filter((j) => j.status === 'completed' || j.status === 'failed').slice(0, 8)
  const cooking = (workerId: string) =>
    fallen[workerId] ? undefined : rest.find((j) => j.status === 'started' && j.workerId === workerId)

  return (
    <LayoutGroup>
      <section className="front">
        <div className="zone">
          <h3>손님 <small>React 화면</small></h3>
          {orderPanel}
        </div>

        <div className="zone desk">
          <h3>홀 매니저 <small>마스터 서버</small></h3>
          <div className="manager">
            <span className="manager-face">{MANAGER.face}</span>
            <span className="manager-name">{MANAGER.name}</span>
            <div className="chef-slot">
              {receiving ? (
                <>
                  <Ticket job={receiving} />
                  <span className="receive">{receiving.id}번 주문 접수!</span>
                </>
              ) : (
                <span className="idle">주문 기다리는 중</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="kitchen">
        <div className="zone">
          <h3>주문 꽂이 <small>RabbitMQ jobs 큐</small></h3>
          <div className="tickets">
            {queued.map((job) => (
              <Ticket key={job.id} job={job} />
            ))}
          </div>
        </div>

        <div className="zone stove">
          <h3>주방 <small>워커 3개 · prefetch=1</small></h3>
          {CHEFS.map((chef) => {
            const job = cooking(chef.workerId)
            return (
              <div key={chef.workerId} className="chef-row">
                <span className={job ? 'chef cooking' : 'chef'}>{fallen[chef.workerId] ? '😵' : chef.face}</span>
                <span className="chef-name">{chef.name}</span>
                <button className="fall-btn" disabled={fallen[chef.workerId]} onClick={() => onCrash(chef.workerId)}>
                  쓰러지기
                </button>
                <div className="chef-slot">
                  {fallen[chef.workerId] ? (
                    <span className="idle">쓰러짐</span>
                  ) : job ? (
                    <Ticket job={job} />
                  ) : (
                    <span className="idle">쉬는 중</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="zone">
          <h3>완성·품절 카운터 <small>결과 이벤트 → 마스터 → DB</small></h3>
          <div className="tickets">
            {done.map((job) => (
              <Ticket key={job.id} job={job} />
            ))}
          </div>
        </div>
      </section>

      <section className="legend">
        <h3>각 요소의 역할</h3>
        <dl>
          {ROLES.map(([name, role]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{role}</dd>
            </div>
          ))}
        </dl>
      </section>
    </LayoutGroup>
  )
}
