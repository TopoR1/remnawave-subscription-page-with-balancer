import type {
    ParsedVlessLink,
    SubscriptionFormat,
    ToporBalancerConfig,
    ToporBalancerDbNode,
    ToporBalancerDebugInfo,
    ToporBalancerLocation,
    ToporBalancerProcessResult,
    ToporRemnawaveTopologySnapshot,
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
    topology?: ToporRemnawaveTopologySnapshot;
    userAccess?: ToporBalancerRuntimeUserAccess;
    debug?: boolean;
    logger?: (message: string) => void;
}

export interface ToporBalancerRuntimeUserAccess {
    squads: Array<{ name: string; uuid: string }>;
    accessibleNodeUuids: string[];
}

interface TechnicalNodeRef {
    location: ToporBalancerLocation;
}

interface MatchingLine {
    line: string;
    parsedLink: ParsedVlessLink;
    nodeRef: TechnicalNodeRef;
}

interface GroupCandidateDiagnostic {
    publicHostCode: string;
    planCode: string;
    userSquads: Array<{ name: string; uuid: string }>;
    accessibleNodesCount: number;
    groupNodesCount: number;
    subscriptionCandidateNodes: string[];
    effectiveCandidateNodes: string[];
    selectedTechnicalHostName?: string;
    warnings: string[];
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
    const selection = await selectNodesByPublicGroupKey(input, matchingLines);
    const outputPlainBody = filterSubscriptionBody(
        plainBody,
        technicalNodeMap,
        selection.selectedByPublicGroupKey,
    );
    const outputBody = encodeSubscriptionBody(outputPlainBody, format, input.body);
    const debugInfo = buildDebugInfo(
        input,
        format,
        plainBody,
        matchingLines,
        selection.selectedByPublicGroupKey,
        selection.groupCandidateDiagnostics,
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
): Promise<{
    groupCandidateDiagnostics: GroupCandidateDiagnostic[];
    selectedByPublicGroupKey: Map<string, ToporBalancerDbNode>;
}> {
    const groups = new Map<string, MatchingLine[]>();

    for (const matchingLine of matchingLines) {
        const publicGroupKey = getPublicGroupKey(matchingLine.nodeRef.location);

        groups.set(publicGroupKey, [...(groups.get(publicGroupKey) ?? []), matchingLine]);
    }

    const selectedByPublicGroupKey = new Map<string, ToporBalancerDbNode>();
    const groupCandidateDiagnostics: GroupCandidateDiagnostic[] = [];

    for (const [publicGroupKey, group] of groups.entries()) {
        const location = group[0].nodeRef.location;
        const subscriptionCandidateTechnicalHostNames = Array.from(
            new Set(
                group
                    .map((matchingLine) => matchingLine.parsedLink.remark)
                    .filter((remark): remark is string => Boolean(remark)),
            ),
        );
        const accessResult = filterCandidatesByUserAccess({
            candidateTechnicalHostNames: subscriptionCandidateTechnicalHostNames,
            input,
            location,
        });
        const warnings = [...accessResult.warnings];

        if (accessResult.effectiveCandidateTechnicalHostNames.length === 0) {
            warnings.push(
                `No accessible TopoR balancer candidates for ${publicGroupKey}; preserving original links.`,
            );
            groupCandidateDiagnostics.push({
                publicHostCode: location.publicHostCode,
                planCode: location.planCode,
                userSquads: input.userAccess?.squads ?? [],
                accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
                groupNodesCount: location.nodes.length,
                subscriptionCandidateNodes: subscriptionCandidateTechnicalHostNames,
                effectiveCandidateNodes: [],
                warnings,
            });
            continue;
        }

        const selectedNode = await input.repository.getOrCreateAssignment({
            shortUuid: input.shortUuid,
            location,
            candidateTechnicalHostNames: accessResult.effectiveCandidateTechnicalHostNames,
        });

        if (selectedNode) {
            selectedByPublicGroupKey.set(publicGroupKey, selectedNode);
        }

        groupCandidateDiagnostics.push({
            publicHostCode: location.publicHostCode,
            planCode: location.planCode,
            userSquads: input.userAccess?.squads ?? [],
            accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
            groupNodesCount: location.nodes.length,
            subscriptionCandidateNodes: subscriptionCandidateTechnicalHostNames,
            effectiveCandidateNodes: accessResult.effectiveCandidateTechnicalHostNames,
            ...(selectedNode ? { selectedTechnicalHostName: selectedNode.technicalHostName } : {}),
            warnings,
        });
    }

    return {
        groupCandidateDiagnostics,
        selectedByPublicGroupKey,
    };
}

function filterCandidatesByUserAccess(input: {
    candidateTechnicalHostNames: string[];
    input: ProcessSubscriptionWithDatabaseBalancerInput;
    location: ToporBalancerLocation;
}): {
    effectiveCandidateTechnicalHostNames: string[];
    warnings: string[];
} {
    if (!input.input.topology && !input.input.userAccess) {
        return {
            effectiveCandidateTechnicalHostNames: input.candidateTechnicalHostNames,
            warnings: [],
        };
    }

    const userSquadUuids = new Set(input.input.userAccess?.squads.map((squad) => squad.uuid) ?? []);
    const userAccessibleNodeUuids = new Set(input.input.userAccess?.accessibleNodeUuids ?? []);
    const hostByRemark = new Map(
        (input.input.topology?.hosts ?? []).map((host) => [host.remark, host]),
    );
    const warnings: string[] = [];
    const effectiveCandidateTechnicalHostNames: string[] = [];

    for (const technicalHostName of input.candidateTechnicalHostNames) {
        const host = hostByRemark.get(technicalHostName);

        if (!host) {
            warnings.push(
                `Candidate ${technicalHostName} has no Remnawave topology host; excluded for user-aware balancing.`,
            );
            continue;
        }

        const hostSquadUuids = new Set(host.accessibleSquads.map((squad) => squad.uuid));
        const isUserNodeAccessible =
            Boolean(host.nodeUuid && userAccessibleNodeUuids.has(host.nodeUuid)) ||
            host.accessibleSquads.some((squad) => userSquadUuids.has(squad.uuid));

        if (
            input.location.squadScope === 'specific_internal_squad' &&
            input.location.internalSquadUuid
        ) {
            if (
                userSquadUuids.size > 0 &&
                !userSquadUuids.has(input.location.internalSquadUuid)
            ) {
                warnings.push(
                    `User is not in required squad ${input.location.internalSquadUuid} for ${getPublicGroupKey(input.location)}.`,
                );
                continue;
            }

            if (!hostSquadUuids.has(input.location.internalSquadUuid)) {
                warnings.push(
                    `Candidate ${technicalHostName} is not accessible to required squad ${input.location.internalSquadUuid}; excluded.`,
                );
                continue;
            }
        }

        if (!isUserNodeAccessible) {
            warnings.push(
                `Candidate ${technicalHostName} is not accessible to this user's squads; excluded.`,
            );
            continue;
        }

        effectiveCandidateTechnicalHostNames.push(technicalHostName);
    }

    return {
        effectiveCandidateTechnicalHostNames,
        warnings,
    };
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
    groupCandidateDiagnostics: GroupCandidateDiagnostic[],
    outputPlainBody: string,
): ToporBalancerDebugInfo {
    const missingSelectionWarnings = buildMissingSelectionWarnings(
        matchingLines,
        selectedByPublicGroupKey,
        groupCandidateDiagnostics,
    );

    return {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks: extractVlessLinks(plainBody).length,
        matchedTechnicalLinks: matchingLines.length,
        userSquads: input.userAccess?.squads ?? [],
        accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
        groupCandidateDiagnostics,
        selectedNodes: Object.fromEntries(
            Array.from(selectedByPublicGroupKey.entries()).map(([publicGroupKey, node]) => [
                publicGroupKey,
                node.technicalHostName,
            ]),
        ),
        outputLinkCount: extractVlessLinks(outputPlainBody).length,
        ...(missingSelectionWarnings.length > 0 || groupCandidateDiagnostics.some((group) => group.warnings.length > 0)
            ? {
                  warnings: [
                      ...missingSelectionWarnings,
                      ...groupCandidateDiagnostics.flatMap((group) => group.warnings),
                  ],
              }
            : {}),
    };
}

function buildMissingSelectionWarnings(
    matchingLines: MatchingLine[],
    selectedByPublicGroupKey: Map<string, ToporBalancerDbNode>,
    groupCandidateDiagnostics: GroupCandidateDiagnostic[],
): string[] {
    const matchingGroupKeys = new Set(
        matchingLines.map((matchingLine) => getPublicGroupKey(matchingLine.nodeRef.location)),
    );
    const noAccessibleCandidateGroupKeys = new Set(
        groupCandidateDiagnostics
            .filter(
                (diagnostic) =>
                    diagnostic.subscriptionCandidateNodes.length > 0 &&
                    diagnostic.effectiveCandidateNodes.length === 0,
            )
            .map((diagnostic) => `${diagnostic.publicHostCode}:${diagnostic.planCode}`),
    );

    return Array.from(matchingGroupKeys)
        .filter(
            (publicGroupKey) =>
                !selectedByPublicGroupKey.has(publicGroupKey) &&
                !noAccessibleCandidateGroupKeys.has(publicGroupKey),
        )
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
