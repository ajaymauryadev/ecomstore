export const actorLabel = (actor) => actor?.name
  ? `${actor.name}${actor.role ? ` (${actor.role.replaceAll('_', ' ')})` : ''}`
  : 'Not recorded';
