import { createHash } from 'node:crypto';

import type {
    ParsedVlessLink,
    SubscriptionFormat,
    ToporBalancerConfig,
    ToporBalancerDebugInfo,
    ToporBalancerLocation,
    ToporBalancerNode,
    ToporBalancerProcessResult,
} from './types';

import {
    decodeSubscriptionBody,
    detectSubscriptionFormat,
    encodeSubscriptionBody,
    extractVlessLinks,
    isUnsupportedAppFallback,
    parseVlessLink,
    replaceVlessRemark,
} from './topor-balancer-subscription.parser';
import { normalizeTechnicalHostName } from './topor-balancer-technical-host-name';

export interface ProcessSubscriptionWithHashBalancerInput {
    shortUuid: string;
    body: string;
    contentType?: string;
    requestPath?: string;
    userAgent?: string;
    config: ToporBalancerConfig;
    debug?: boolean;
    logger?: (message: string) => void;
}

interface TechnicalNodeRef {
    location: ToporBalancerLocation;
    node: ToporBalancerNode;
}

interface MatchingLine {
    line: string;
    parsedLink: ParsedVlessLink;
    nodeRef: TechnicalNodeRef;
}

function getPublicGroupKey(location: ToporBalancerLocation): string {
    return `${location.publicHostCode}:${location.planCode}`;
}

export function processSubscriptionWithHashBalancer(
    input: ProcessSubscriptionWithHashBalancerInput,
): ToporBalancerProcessResult;

export function processSubscriptionWithHashBalancer(
    shortUuid: string,
    body: string,
    contentType: string | undefined,
    config: ToporBalancerConfig,
    options?: Pick<ProcessSubscriptionWithHashBalancerInput, 'debug' | 'logger'>,
): ToporBalancerProcessResult;

export function processSubscriptionWithHashBalancer(
    inputOrShortUuid: ProcessSubscriptionWithHashBalancerInput | string,
    body?: string,
    contentType?: string,
    config?: ToporBalancerConfig,
    options?: Pick<ProcessSubscriptionWithHashBalancerInput, 'debug' | 'logger'>,
): ToporBalancerProcessResult {
    const input =
        typeof inputOrShortUuid === 'string'
            ? {
                  shortUuid: inputOrShortUuid,
                  body: body ?? '',
                  contentType,
                  config: config ?? {
                      enabled: false,
                      locations: [],
                  },
                  ...options,
              }
            : inputOrShortUuid;
    const format = detectSubscriptionFormat(input.body, input.contentType);

    if (format !== 'plain_links' && format !== 'base64_links') {
        return buildUnchangedResult(input, format);
    }

    const plainBody = decodeSubscriptionBody(input.body, format);
    const inputLinks = extractVlessLinks(plainBody);

    if (isUnsupportedAppFallback(inputLinks)) {
        return buildUnsupportedAppResult(input, format, plainBody);
    }

    const technicalNodeMap = buildTechnicalNodeMap(input.config);
    const matchingLines = collectMatchingLines(plainBody, technicalNodeMap);
    const selectedByPublicGroupKey = selectNodesByPublicGroupKey(input.shortUuid, matchingLines);
    const outputPlainBody = filterSubscriptionBody(
        plainBody,
        technicalNodeMap,
        selectedByPublicGroupKey,
    );
    const outputBody = encodeSubscriptionBody(outputPlainBody, format, input.body);
    const debugInfo = buildDebugInfo(
        input.shortUuid,
        format,
        plainBody,
        matchingLines,
        selectedByPublicGroupKey,
        outputPlainBody,
        input.requestPath,
        input.userAgent,
    );

    logDebugInfo(input, debugInfo);

    return {
        body: outputBody,
        debugInfo,
    };
}

function buildUnsupportedAppResult(
    input: ProcessSubscriptionWithHashBalancerInput,
    format: SubscriptionFormat,
    plainBody: string,
): ToporBalancerProcessResult {
    const debugInfo: ToporBalancerDebugInfo = {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks: extractVlessLinks(plainBody).length,
        matchedTechnicalLinks: 0,
        selectedNodes: {},
        outputLinkCount: extractVlessLinks(plainBody).length,
        warnings: ['Remnawave returned App not supported fallback.'],
    };

    logDebugInfo(input, debugInfo);

    return {
        body: input.body,
        debugInfo,
    };
}

function buildUnchangedResult(
    input: ProcessSubscriptionWithHashBalancerInput,
    format: SubscriptionFormat,
): ToporBalancerProcessResult {
    const debugInfo: ToporBalancerDebugInfo = {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks: 0,
        matchedTechnicalLinks: 0,
        selectedNodes: {},
        outputLinkCount: 0,
    };

    logDebugInfo(input, debugInfo);

    return {
        body: input.body,
        debugInfo,
    };
}

function buildTechnicalNodeMap(config: ToporBalancerConfig): Map<string, TechnicalNodeRef> {
    const technicalNodeMap = new Map<string, TechnicalNodeRef>();

    for (const location of config.locations) {
        for (const node of location.nodes) {
            technicalNodeMap.set(normalizeTechnicalHostName(node.technicalHostName), {
                location,
                node,
            });
        }
    }

    return technicalNodeMap;
}

function collectMatchingLines(
    plainBody: string,
    technicalNodeMap: Map<string, TechnicalNodeRef>,
): MatchingLine[] {
    const matchingLines: MatchingLine[] = [];

    for (const line of plainBody.split(/\r?\n/)) {
        const parsedLink = parseVlessLink(line.trim());

        if (!parsedLink?.remark) {
            continue;
        }

        const nodeRef = technicalNodeMap.get(normalizeTechnicalHostName(parsedLink.remark));

        if (!nodeRef) {
            continue;
        }

        matchingLines.push({
            line,
            parsedLink,
            nodeRef,
        });
    }

    return matchingLines;
}

function selectNodesByPublicGroupKey(
    shortUuid: string,
    matchingLines: MatchingLine[],
): Map<string, TechnicalNodeRef> {
    const groups = new Map<string, MatchingLine[]>();

    for (const matchingLine of matchingLines) {
        const publicGroupKey = getPublicGroupKey(matchingLine.nodeRef.location);

        groups.set(publicGroupKey, [...(groups.get(publicGroupKey) ?? []), matchingLine]);
    }

    const selectedByPublicGroupKey = new Map<string, TechnicalNodeRef>();

    for (const [publicGroupKey, group] of groups.entries()) {
        const activeCandidates = uniqueNodeRefs(group)
            .filter((nodeRef) => nodeRef.node.status === 'active')
            .sort((left, right) =>
                left.node.technicalHostName.localeCompare(right.node.technicalHostName),
            );

        const selectedNodeRef = selectHashModeNode(shortUuid, publicGroupKey, activeCandidates);

        if (selectedNodeRef) {
            selectedByPublicGroupKey.set(publicGroupKey, selectedNodeRef);
        }
    }

    return selectedByPublicGroupKey;
}

function uniqueNodeRefs(matchingLines: MatchingLine[]): TechnicalNodeRef[] {
    const uniqueByTechnicalHostName = new Map<string, TechnicalNodeRef>();

    for (const matchingLine of matchingLines) {
        uniqueByTechnicalHostName.set(
            matchingLine.nodeRef.node.technicalHostName,
            matchingLine.nodeRef,
        );
    }

    return Array.from(uniqueByTechnicalHostName.values());
}

function selectHashModeNode(
    shortUuid: string,
    publicGroupKey: string,
    candidates: TechnicalNodeRef[],
): TechnicalNodeRef | null {
    const strategy = candidates[0]?.location.strategy ?? 'sticky_hash';

    switch (strategy) {
        case 'manual':
            return null;
        case 'priority_failover':
            return (
                candidates
                    .slice()
                    .sort(
                        (left, right) =>
                            (left.node.priority ?? 100) - (right.node.priority ?? 100) ||
                            left.node.technicalHostName.localeCompare(
                                right.node.technicalHostName,
                            ),
                    )[0] ?? null
            );
        case 'weighted':
            return selectWeightedNode(shortUuid, publicGroupKey, candidates);
        case 'least_loaded':
        case 'sticky_hash':
        default:
            return selectStickyHashNode(shortUuid, publicGroupKey, candidates);
    }
}

function selectStickyHashNode(
    shortUuid: string,
    publicGroupKey: string,
    candidates: TechnicalNodeRef[],
): TechnicalNodeRef | null {
    if (candidates.length === 0) {
        return null;
    }

    const hashValue = hashToBigInt(`${shortUuid}:${publicGroupKey}`);
    const index = Number(hashValue % BigInt(candidates.length));

    return candidates[index];
}

function selectWeightedNode(
    shortUuid: string,
    publicHostCode: string,
    candidates: TechnicalNodeRef[],
): TechnicalNodeRef | null {
    if (candidates.length === 0) {
        return null;
    }

    const totalWeight = candidates.reduce(
        (sum, candidate) => sum + getNodeWeight(candidate.node),
        0,
    );
    const hashValue = hashToBigInt(`${shortUuid}:${publicHostCode}`);
    let cursor = Number(hashValue % BigInt(totalWeight));

    for (const candidate of candidates) {
        cursor -= getNodeWeight(candidate.node);

        if (cursor < 0) {
            return candidate;
        }
    }

    return candidates[0];
}

function filterSubscriptionBody(
    plainBody: string,
    technicalNodeMap: Map<string, TechnicalNodeRef>,
    selectedByPublicGroupKey: Map<string, TechnicalNodeRef>,
): string {
    const keptSelectedPublicGroupKeys = new Set<string>();
    const outputLines: string[] = [];

    for (const line of plainBody.split(/\r?\n/)) {
        const trimmedLine = line.trim();
        const parsedLink = parseVlessLink(trimmedLine);

        if (!parsedLink?.remark) {
            outputLines.push(line);
            continue;
        }

        const nodeRef = technicalNodeMap.get(normalizeTechnicalHostName(parsedLink.remark));

        if (!nodeRef) {
            outputLines.push(line);
            continue;
        }

        const publicGroupKey = getPublicGroupKey(nodeRef.location);
        const selectedNodeRef = selectedByPublicGroupKey.get(publicGroupKey);

        if (!selectedNodeRef) {
            outputLines.push(line);
            continue;
        }

        if (
            normalizeTechnicalHostName(parsedLink.remark) !==
            normalizeTechnicalHostName(selectedNodeRef.node.technicalHostName)
        ) {
            continue;
        }

        if (keptSelectedPublicGroupKeys.has(publicGroupKey)) {
            continue;
        }

        keptSelectedPublicGroupKeys.add(publicGroupKey);
        outputLines.push(replaceVlessRemark(trimmedLine, selectedNodeRef.location.publicName));
    }

    return outputLines.join('\n');
}

function buildDebugInfo(
    shortUuid: string,
    format: SubscriptionFormat,
    plainBody: string,
    matchingLines: MatchingLine[],
    selectedByPublicGroupKey: Map<string, TechnicalNodeRef>,
    outputPlainBody: string,
    requestPath?: string,
    userAgent?: string,
): ToporBalancerDebugInfo {
    const missingSelectionWarnings = buildMissingSelectionWarnings(
        matchingLines,
        selectedByPublicGroupKey,
    );

    return {
        shortUuid,
        requestPath,
        userAgent,
        detectedFormat: format,
        totalVlessLinks: extractVlessLinks(plainBody).length,
        matchedTechnicalLinks: matchingLines.length,
        selectedNodes: Object.fromEntries(
            Array.from(selectedByPublicGroupKey.entries()).map(([publicGroupKey, nodeRef]) => [
                publicGroupKey,
                nodeRef.node.technicalHostName,
            ]),
        ),
        outputLinkCount: extractVlessLinks(outputPlainBody).length,
        ...(missingSelectionWarnings.length > 0 ? { warnings: missingSelectionWarnings } : {}),
    };
}

function buildMissingSelectionWarnings(
    matchingLines: MatchingLine[],
    selectedByPublicGroupKey: Map<string, TechnicalNodeRef>,
): string[] {
    const matchingGroupKeys = new Set(
        matchingLines.map((matchingLine) => getPublicGroupKey(matchingLine.nodeRef.location)),
    );

    return Array.from(matchingGroupKeys)
        .filter((publicGroupKey) => !selectedByPublicGroupKey.has(publicGroupKey))
        .map(
            (publicGroupKey) =>
                `No active TopoR balancer node for ${publicGroupKey}; preserving original links.`,
        );
}

function logDebugInfo(
    input: ProcessSubscriptionWithHashBalancerInput,
    debugInfo: ToporBalancerDebugInfo,
): void {
    const isDebugEnabled = input.debug ?? process.env.TOPOR_BALANCER_DEBUG === 'true';

    if (!isDebugEnabled) {
        return;
    }

    const logger = input.logger ?? defaultDebugLogger;

    logger(`[TOPOR_BALANCER_DEBUG] ${JSON.stringify(debugInfo)}`);

    for (const warning of debugInfo.warnings ?? []) {
        logger(`[TOPOR_BALANCER_WARNING] ${warning}`);
    }
}

function defaultDebugLogger(message: string): void {
    process.stdout.write(`${message}\n`);
}

function getNodeWeight(node: ToporBalancerNode): number {
    return Number.isInteger(node.weight) && node.weight > 0 ? node.weight : 1;
}

function hashToBigInt(value: string): bigint {
    return BigInt(`0x${createHash('sha256').update(value).digest('hex')}`);
}
