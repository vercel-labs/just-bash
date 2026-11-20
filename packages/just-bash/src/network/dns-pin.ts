/** Types for the deprecated request-owned connection override. */
export interface PinnedAddress {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export interface PinnedConnectionOwner {
  fetch(url: string, init: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export type PinnedConnectionOwnerFactory = (
  pinned: PinnedAddress,
) => Promise<PinnedConnectionOwner>;
