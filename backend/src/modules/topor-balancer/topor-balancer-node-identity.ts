import { createHash } from 'node:crypto';

import type { ParsedVlessLink, ToporBalancerDiscoveredHost, ToporRemnawaveTopologyHost } from './types';

export interface ToporBalancerNodeIdentityInput {
    flow?: string;
    host?: string;
    pbk?: string;
    port?: number;
    security?: string;
    sid?: string;
    sni?: string;
    transport?: string;
    type?: string;
}

export function buildToporBalancerIdentityKey(
    input: ToporBalancerNodeIdentityInput,
): string | undefined {
    const host = normalizeIdentityPart(input.host);
    const port = normalizePort(input.port);

    if (!host || !port) {
        return undefined;
    }

    const canonical = {
        flow: normalizeIdentityPart(input.flow),
        host,
        pbk: normalizeIdentityPart(input.pbk),
        port,
        security: normalizeIdentityPart(input.security),
        sid: normalizeIdentityPart(input.sid),
        sni: normalizeIdentityPart(input.sni),
        transport: normalizeIdentityPart(input.transport ?? input.type),
    };

    return `vless-stable:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

export function buildToporBalancerIdentityKeyFromDiscoveredHost(
    host: ToporBalancerDiscoveredHost,
): string | undefined {
    return (
        buildToporBalancerIdentityKey({
            flow: host.flow,
            host: host.host,
            pbk: host.pbk,
            port: host.port,
            security: host.security,
            sid: host.sid,
            sni: host.sni,
            transport: host.type,
        }) ?? buildUuidIdentityKey(host.remnawaveHostUuid, 'remnawave-host')
    );
}

export function buildToporBalancerIdentityKeyFromParsedLink(
    link: ParsedVlessLink,
): string | undefined {
    return buildToporBalancerIdentityKey({
        flow: link.flow,
        host: link.host,
        pbk: link.pbk,
        port: link.port,
        security: link.security,
        sid: link.sid,
        sni: link.sni,
        transport: link.type,
    });
}

export function buildToporBalancerIdentityKeyFromTopologyHost(
    host: ToporRemnawaveTopologyHost,
): string | undefined {
    return (
        buildToporBalancerIdentityKey({
            flow: host.flow,
            host: host.address,
            port: host.port,
            security: host.security,
            sni: host.sni,
            transport: host.transport,
        }) ?? buildUuidIdentityKey(host.uuid, 'remnawave-host')
    );
}

export function buildUuidIdentityKey(uuid: string | undefined, prefix: string): string | undefined {
    const normalized = normalizeIdentityPart(uuid);

    return normalized ? `${prefix}:${normalized}` : undefined;
}

export function maskToporBalancerIdentityKey(identityKey: string | undefined): string | undefined {
    if (!identityKey) {
        return undefined;
    }

    if (identityKey.length <= 18) {
        return identityKey;
    }

    return `${identityKey.slice(0, 14)}...${identityKey.slice(-8)}`;
}

function normalizeIdentityPart(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();

    return normalized ? normalized : undefined;
}

function normalizePort(value: number | undefined): number | undefined {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
        return undefined;
    }

    return Math.trunc(value);
}
