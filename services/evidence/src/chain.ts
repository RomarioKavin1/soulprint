/** Read-only chain access: piece roles/status, capture-key segments, access keys. */
import { genesis, parseNearPublicKey, b64 } from "@soulprint/proof";

export interface PieceView {
  pieceId: string;
  artist: string;
  owner: string;
  status: string;
  mode: string;
}
export interface PieceWithSegments extends PieceView {
  segments: { key: Uint8Array; genesis: Uint8Array }[];
}
export interface ChainReader {
  piece(pieceId: string): Promise<PieceWithSegments | null>;
  /** True if `publicKey` (ed25519:…) is a full-access key of `account` (NEP-413 auth). */
  isFullAccessKey(account: string, publicKey: string): Promise<boolean>;
}

export class RpcChainReader implements ChainReader {
  constructor(private rpcUrl: string) {}

  private async rpc(params: Record<string, unknown>): Promise<any> {
    const r = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "evidence", method: "query", params: { finality: "final", ...params } }),
    });
    const j = (await r.json()) as any;
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j.result;
  }

  async view<T>(account: string, method: string, args: unknown): Promise<T | null> {
    try {
      const res = await this.rpc({ request_type: "call_function", account_id: account, method_name: method, args_base64: b64.encode(new TextEncoder().encode(JSON.stringify(args))) });
      if (res.error) return null;
      return JSON.parse(new TextDecoder().decode(new Uint8Array(res.result))) as T;
    } catch {
      return null;
    }
  }

  async piece(pieceId: string): Promise<PieceWithSegments | null> {
    const info = await this.view<any>(pieceId, "piece_info", {});
    if (!info) return null;
    const proof = await this.view<any>(pieceId, "proof_page", { from: 0, limit: 0 });
    const segments = (proof?.segments ?? []).map((s: any) => {
      const key = parseNearPublicKey(s.key);
      return { key, genesis: genesis(pieceId, key) };
    });
    return { pieceId, artist: info.artist, owner: info.owner, status: info.status, mode: info.mode, segments };
  }

  async isFullAccessKey(account: string, publicKey: string): Promise<boolean> {
    try {
      const r = await this.rpc({ request_type: "view_access_key", account_id: account, public_key: publicKey });
      return r.permission === "FullAccess";
    } catch {
      return false;
    }
  }
}
