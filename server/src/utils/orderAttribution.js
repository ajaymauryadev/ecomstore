export const actorSnapshot = (user, at = new Date()) => user ? ({
  userId: user._id, name: user.name, role: user.role, at,
}) : null;

export const recordOrderAction = (order, user, action, message, { field, assignee, previousAssignee, at = new Date() } = {}) => {
  const performedBy = actorSnapshot(user, at);
  if (field) order.set(`fulfillment.${field}`, performedBy);
  order.timeline.push({
    status: order.status, action, message, timestamp: at, performedBy,
    ...(assignee && { assignee: actorSnapshot(assignee, at) }),
    ...(previousAssignee && { previousAssignee }),
  });
  return performedBy;
};
