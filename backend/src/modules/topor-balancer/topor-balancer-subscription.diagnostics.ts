import type { ParsedVlessLink, ToporBalancerMaskedLinkDiff } from './types';

import { extractVlessLinks } from './topor-balancer-subscription.parser';

const COMPARED_FIELDS = [
    'protocol',
    'uuid',
    'host',
    'port',
    'rawQuery',
    'security',
    'sni',
    'fp',
    'pbk',
    'sid',
    'flow',
    'type',
    'path',
    'serviceName',
    'alpn',
    'remark',
] as const;

export function buildMaskedVlessDiff(
    inputPlainBody: string,
    outputPlainBody: string,
): ToporBalancerMaskedLinkDiff[] {
    const inputLinks = extractVlessLinks(inputPlainBody);
    const outputLinks = extractVlessLinks(outputPlainBody);
    const outputByStableKey = new Map(outputLinks.map((link) => [buildStableLinkKey(link), link]));
    const maxLength = Math.max(inputLinks.length, outputLinks.length);
    const diffs: ToporBalancerMaskedLinkDiff[] = [];

    for (let index = 0; index < maxLength; index += 1) {
        const input = inputLinks[index];
        const output = input ? outputByStableKey.get(buildStableLinkKey(input)) : outputLinks[index];

        if (!input && !output) {
            continue;
        }

        const changedFields = input && output ? compareFields(input, output) : ['presence'];
        const selected = Boolean(output);

        if (changedFields.length === 0 && selected) {
            continue;
        }

        diffs.push({
            index,
            selected,
            ...(input ? { input: maskLink(input) } : {}),
            ...(output ? { output: maskLink(output) } : {}),
            changedFields,
            ...(!selected ? { warning: 'Input VLESS link was filtered out by balancer selection.' } : {}),
        });
    }

    return diffs;
}

function compareFields(input: ParsedVlessLink, output: ParsedVlessLink): string[] {
    const changedFields: string[] = [];

    for (const field of COMPARED_FIELDS) {
        if (input[field] !== output[field]) {
            changedFields.push(field);
        }
    }

    const inputKeys = Object.keys(input.queryParams).sort().join(',');
    const outputKeys = Object.keys(output.queryParams).sort().join(',');

    if (inputKeys !== outputKeys) {
        changedFields.push('queryParamKeys');
    }

    return changedFields;
}

function maskLink(link: ParsedVlessLink): ToporBalancerMaskedLinkDiff['input'] {
    return {
        protocol: link.protocol,
        host: link.host,
        port: link.port,
        remark: link.remark,
        uuid: maskSecret(link.uuid),
        pbk: maskSecret(link.pbk),
        sid: maskSecret(link.sid),
        queryParamKeys: Object.keys(link.queryParams).sort(),
    };
}

function buildStableLinkKey(link: ParsedVlessLink): string {
    return [
        link.protocol,
        link.uuid,
        link.host,
        link.port ?? '',
        link.rawQuery,
    ].join('|');
}

function maskSecret(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }

    if (value.length <= 8) {
        return `${value.slice(0, 2)}...${value.slice(-2)}`;
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
