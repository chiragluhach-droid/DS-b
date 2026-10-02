/**
 * What may be shown about a donor on a page anyone can open.
 *
 * A name typed at checkout is not permission to publish it. Only an explicit,
 * unticked-by-default consent releases a name or a message, so records made
 * before consent existed — or by donors who declined — stay anonymous.
 */
export interface DonorSnapshotLike {
  name: string;
  isAnonymous: boolean;
  message?: string;
  consent?: {
    publicName?: boolean;
    publicMessage?: boolean;
  };
}

export function publicDonorSnapshot(snapshot: DonorSnapshotLike, anonymousLabel = 'Anonymous donor') {
  const mayShowName = Boolean(snapshot.consent?.publicName) && !snapshot.isAnonymous;
  const mayShowMessage = Boolean(snapshot.consent?.publicMessage);

  return {
    name: mayShowName ? snapshot.name : anonymousLabel,
    isAnonymous: !mayShowName,
    message: mayShowMessage ? snapshot.message : undefined,
  };
}
