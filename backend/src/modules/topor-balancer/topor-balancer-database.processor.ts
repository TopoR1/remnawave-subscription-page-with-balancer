import type {
    ParsedVlessLink,
    SubscriptionFormat,
    ToporBalancerConfig,
    ToporBalancerDbNode,
    ToporBalancerDebugInfo,
    ToporBalancerLocation,
    ToporBalancerProcessResult,
} from './types';
import type { ToporBalancerAssignmentRepository } from './topor-balancer-database.repository';

import {
    decodeSubscriptionBody,
    detectSubscriptionFormat,
    encodeSubscriptionBody,
    extractVlessLinks,
    parseVlessLink,
    replaceVlessRemark,
} from './topor-balancer-subscription.parser';

export interface ProcessSubscriptionWithDatabaseBalancerInput {
    shortUuid: string;
    body: string;
    contentType?: string;
    requestPath?: string;
    userAgent?: string;
    config: ToporBalancerConfig;
    repository: ToporBalancerAssignmentRepository;
    debug?: boolean;
    logger?: (message: string) => void;
}

interface TechnicalNodeRef {
    location: ToporBalancerLocation;
}

interface MatchingLine {
    line: string;
    parsedLink: ParsedVlessLink;
    nodeRef: TechnicalNodeRef;
}

function getPublicGroupKey(location: ToporBalancerLocation): string {
    return `${location.publicHostCode}:${location.planCode}`;
}

export async function processSubscriptionWithDatabaseBalancer(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
): Promise<ToporBalancerProcessResult> {
    const format = detectSubscriptionFormat(input.body, input.contentType);

    if (format !== 'plain_links' && format !== 'base64_links') {
        return buildUnchangedResult(input, format);
    }

    const plainBody = decodeSubscriptionBody(input.body, format);
    const technicalNodeMap = buildTechnicalNodeMap(input.config);
    const matchingLines = collectMatchingLines(plainBody, technicalNodeMap);
    const selectedByPublicGroupKey = await selectNodesByPublicGroupKey(input, matchingLines);
    const outputPlainBody = filterSubscriptionBody(
        plainBody,
        technicalNodeMap,
        selectedByPublicGroupKey,
    );
    const outputBody = encodeSubscriptionBody(outputPlainBody, format, input.body);
    const debugInfo = buildDebugInfo(
        input,
        format,
        plainBody,
        matchingLines,
        selectedByPublicGroupKey,
        outputPlainBody,
    );

    await input.repository.recordRequest({
        shortUuid: input.shortUuid,
        userAgent: input.userAgent,
        responseFormat: format,
        inputLinksCount: debugInfo.totalVlessLinks,
        outputLinksCount: debugInfo.outputLinkCount,
    });

    logDebugInfo(input, debugInfo);

    return {
        body: outputBody,
        debugInfo,
    };
}

function buildUnchangedResult(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
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
            technicalNodeMap.set(node.technicalHostName, {
                location,
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

        const nodeRef = technicalNodeMap.get(parsedLink.remark);

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

async function selectNodesByPublicGroupKey(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    matchingLines: MatchingLine[],
): Promise<Map<string, ToporBalancerDbNode>> {
    const groups = new Map<string, MatchingLine[]>();

    for (const matchingLine of matchingLines) {
        const publicGroupKey = getPublicGroupKey(matchingLine.nodeRef.location);

        groups.set(publicGroupKey, [...(groups.get(publicGroupKey) ?? []), matchingLine]);
    }

    const selectedByPublicGroupKey = new Map<string, ToporBalancerDbNode>();

    for (const [publicGroupKey, group] of groups.entries()) {
        const location = group[0].nodeRef.location;
        const candidateTechnicalHostNames = Array.from(
            new Set(
                group
                    .map((matchingLine) => matchingLine.parsedLink.remark)
                    .filter((remark): remark is string => Boolean(remark)),
            ),
        );
        const selectedNode = await input.repository.getOrCreateAssignment({
            shortUuid: input.shortUuid,
            location,
            candidateTechnicalHostNames,
        });

        if (selectedNode) {
            selectedByPublicGroupKey.set(publicGroupKey, selectedNode);
        }
    }

    return selectedByPublicGroupKey;
}

function filterSubscriptionBody(
    plainBody: string,
    technicalNodeMap: Map<string, TechnicalNodeRef>,
    selectedByPublicGroupKey: Map<string, ToporBalancerDbNode>,
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

        const nodeRef = technicalNodeMap.get(parsedLink.remark);

        if (!nodeRef) {
            outputLines.push(line);
            continue;
        }

        const publicGroupKey = getPublicGroupKey(nodeRef.location);
        const selectedNode = selectedByPublicGroupKey.get(publicGroupKey);

        if (!selectedNode) {
            outputLines.push(line);
            continue;
        }

        if (parsedLink.remark !== selectedNode.technicalHostName) {
            continue;
        }

        if (keptSelectedPublicGroupKeys.has(publicGroupKey)) {
            continue;
        }

        keptSelectedPublicGroupKeys.add(publicGroupKey);
        outputLines.push(replaceVlessRemark(trimmedLine, selectedNode.publicName));
    }

    return outputLines.join('\n');
}

function buildDebugInfo(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    format: SubscriptionFormat,
    plainBody: string,
    matchingLines: MatchingLine[],
    selectedByPublicGroupKey: Map<string, ToporBalancerDbNode>,
    outputPlainBody: string,
): ToporBalancerDebugInfo {
    const missingSelectionWarnings = buildMissingSelectionWarnings(
        matchingLines,
        selectedByPublicGroupKey,
    );

    return {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks: extractVlessLinks(plainBody).length,
        matchedTechnicalLinks: matchingLines.length,
        selectedNodes: Object.fromEntries(
            Array.from(selectedByPublicGroupKey.entries()).map(([publicGroupKey, node]) => [
                publicGroupKey,
                node.technicalHostName,
            ]),
        ),
        outputLinkCount: extractVlessLinks(outputPlainBody).length,
        ...(missingSelectionWarnings.length > 0 ? { warnings: missingSelectionWarnings } : {}),
    };
}

function buildMissingSelectionWarnings(
    matchingLines: MatchingLine[],
    selectedByPublicGroupKey: Map<string, ToporBalancerDbNode>,
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
    input: ProcessSubscriptionWithDatabaseBalancerInput,
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
