import type { AthleteInviteHype, HypeCardReplyInbox } from '@workspace/api-client-react';

export function getLatestFanActivity(
  fanHypes: AthleteInviteHype[] | undefined,
  inbox: HypeCardReplyInbox | undefined,
  limit = 2,
) {
  return [
    ...(fanHypes ?? []).map((hype) => ({
      id: `hype-${hype.id}`,
      reaction: hype.reaction,
      title: hype.senderName ? `Fan Shoutout · ${hype.senderName}` : 'Fan Shoutout · Anonymous',
      message: hype.message || 'Sent a Shoutout',
      createdAt: hype.createdAt,
    })),
    ...(inbox?.groups ?? []).flatMap((group) => group.replies.map((reply) => ({
      id: `reply-${reply.id}`,
      reaction: reply.reaction,
      title: `Media reply · ${group.title}`,
      message: reply.message || 'Reacted to your Hype Card',
      createdAt: reply.createdAt,
    }))),
  ]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}