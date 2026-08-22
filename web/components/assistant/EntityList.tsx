export function EntityList({ entities = [] }: { entities?: string[] }) { return <ul className="entity-list">{entities.map(entity => <li key={entity}>{entity}</li>)}</ul> }
