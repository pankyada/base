import { desks, rooms } from '../scene/floorplan.js'
import type { SceneState } from '../scene/reducer.js'
import { Worker } from './Worker.js'

export function Floor({ scene, selected, onSelect }: { scene: SceneState; selected?: string; onSelect(agent?: string): void }) {
  return <section className="floor-wrap" aria-label="Live agent office floor">
    <svg className="floor" viewBox="0 0 1000 790" role="img">
      <rect className="floor-base" x="0" y="0" width="1000" height="790" rx="22" />
      <g className="top-row"><rect x="20" y="25" width="290" height="180" rx="16" /><text x="44" y="60">FRONT DESK</text><rect x="350" y="25" width="290" height="180" rx="16" /><text x="374" y="60">BULLETIN BOARD</text><rect x="680" y="25" width="300" height="180" rx="16" /><text x="704" y="60">VAULT</text></g>
      {Object.entries(rooms).map(([id, room]) => <g key={id} className={`room room-${id}`}><rect x={room.x} y={room.y} width={room.width} height={room.height} rx="16" /><text x={room.x + 18} y={room.y + 30}>{room.label.toUpperCase()}</text></g>)}
      {desks.map((desk, index) => <g className="desk" key={index}><rect x={desk.x - 44} y={desk.y - 24} width="88" height="43" rx="8" /><text x={desk.x} y={desk.y + 7} textAnchor="middle">desk {index + 1}</text></g>)}
      {Object.values(scene.workers).map(worker => {
        const desk = scene.seats[worker.frame.agent_id]
        const room = rooms[worker.room]
        const x = desk === undefined ? 920 : worker.room === 'desk' ? desks[desk].x : room.x + room.width / 2
        const y = desk === undefined ? 430 : worker.room === 'desk' ? desks[desk].y - 34 : room.y + room.height / 2
        return <Worker key={worker.frame.agent_id} worker={worker} x={x} y={y} selected={selected === worker.frame.agent_id} onSelect={() => onSelect(worker.frame.agent_id)} />
      })}
    </svg>
  </section>
}
