import { Redirect } from 'wouter';

export function SharedLockerPage({ params }: { params: { inviteToken?: string } }) {
  const token = params.inviteToken?.trim();
  return token
    ? <Redirect to={`/showcase/${encodeURIComponent(token)}`} />
    : <Redirect to="/" />;
}

export default SharedLockerPage;
