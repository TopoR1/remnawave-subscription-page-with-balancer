import type {
    ParsedVlessLink,
    SubscriptionFormat,
    ToporBalancerConfig,
    ToporBalancerDbNode,
    ToporBalancerDebugInfo,
    ToporBalancerLocation,
    ToporBalancerNodeStatus,
    ToporBalancerProcessResult,
    ToporRemnawaveTopologySnapshot,
} from './types';
import type { ToporBalancerAssignmentRepository } from './topor-balancer-database.repository';

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
    node: ToporBalancerLocation['nodes'][number];
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
    excludedNodes: ExcludedCandidateNode[];
    previousAssignedNode?: string;
    previousAssignedNodeStatus?: ToporBalancerNodeStatus | 'not_in_subscription' | 'unknown';
    reassignmentAttempted: boolean;
    reassignmentResult?: 'kept' | 'reassigned' | 'failed' | 'not_needed';
    selectedTechnicalHostName?: string;
    failOpenReason?: 'no_active_candidates' | 'node_dead' | 'node_disabled' | 'manual_strategy';
    warnings: string[];
}

type ExcludedCandidateNodeReason =
    | 'missing_topology'
    | 'not_accessible_to_group_squad'
    | 'not_accessible_to_user_squad'
    | 'not_in_subscription'
    | 'user_not_in_group_squad'
    | 'node_disabled'
    | 'node_dead'
    | 'node_draining';

interface ExcludedCandidateNode {
    technicalHostName: string;
    reason: ExcludedCandidateNodeReason;
    message: string;
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
    const inputLinks = extractVlessLinks(plainBody);

    if (isUnsupportedAppFallback(inputLinks)) {
        return buildUnsupportedAppResult(input, format, plainBody);
    }

    const technicalNodeMap = buildTechnicalNodeMap(input.config);
    const matchingLines = collectMatchingLines(plainBody, technicalNodeMap);
    let selection: Awaited<ReturnType<typeof selectNodesByPublicGroupKey>>;

    try {
        selection = await selectNodesByPublicGroupKey(input, matchingLines);
    } catch (error) {
        input.logger?.(`TopoR database assignment selection failed open: ${formatSafeError(error)}`);

        return buildDatabaseFailOpenResult(input, format, plainBody, 'assignment_selection_failed');
    }
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

    await recordRequestFailOpen(input, {
        groupCandidateDiagnostics: debugInfo.groupCandidateDiagnostics ?? [],
        shortUuid: input.shortUuid,
        userAgent: input.userAgent,
        responseFormat: format,
        inputLinksCount: debugInfo.totalVlessLinks,
        matchedTechnicalLinks: debugInfo.matchedTechnicalLinks,
        outputLinksCount: debugInfo.outputLinkCount,
        rewrittenLinksCount: Object.keys(debugInfo.selectedNodes).length,
        selectedNodes: debugInfo.selectedNodes,
        status: getRuntimeDiagnosticsStatus(debugInfo),
        warnings: debugInfo.warnings ?? [],
    });

    logDebugInfo(input, debugInfo);

    return {
        body: outputBody,
        debugInfo,
    };
}

async function buildUnsupportedAppResult(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    format: SubscriptionFormat,
    plainBody: string,
): Promise<ToporBalancerProcessResult> {
    const debugInfo: ToporBalancerDebugInfo = {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks: extractVlessLinks(plainBody).length,
        matchedTechnicalLinks: 0,
        groupCandidateDiagnostics: input.config.locations.map((location) => ({
            publicHostCode: location.publicHostCode,
            planCode: location.planCode,
            userSquads: input.userAccess?.squads ?? [],
            accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
            groupNodesCount: location.nodes.length,
            subscriptionCandidateNodes: [],
            effectiveCandidateNodes: [],
            excludedNodes: [],
            reassignmentAttempted: false,
            reassignmentResult: 'not_needed',
            warnings: ['unsupported_app'],
        })),
        selectedNodes: {},
        outputLinkCount: extractVlessLinks(plainBody).length,
        warnings: ['Remnawave returned App not supported fallback.'],
    };

    await recordRequestFailOpen(input, {
        groupCandidateDiagnostics: debugInfo.groupCandidateDiagnostics ?? [],
        shortUuid: input.shortUuid,
        userAgent: input.userAgent,
        responseFormat: format,
        inputLinksCount: debugInfo.totalVlessLinks,
        matchedTechnicalLinks: 0,
        outputLinksCount: debugInfo.outputLinkCount,
        rewrittenLinksCount: 0,
        selectedNodes: {},
        status: 'unsupported_app',
        warnings: debugInfo.warnings ?? [],
    });

    logDebugInfo(input, debugInfo);

    return {
        body: input.body,
        debugInfo,
    };
}

async function recordRequestFailOpen(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    request: Parameters<ToporBalancerAssignmentRepository['recordRequest']>[0],
): Promise<void> {
    try {
        await input.repository.recordRequest(request);
    } catch (error) {
        input.logger?.(`TopoR optional request history write failed: ${formatSafeError(error)}`);
    }
}

function buildDatabaseFailOpenResult(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    format: SubscriptionFormat,
    plainBody: string,
    reason: string,
): ToporBalancerProcessResult {
    const totalVlessLinks = extractVlessLinks(plainBody).length;
    const debugInfo: ToporBalancerDebugInfo = {
        shortUuid: input.shortUuid,
        requestPath: input.requestPath,
        userAgent: input.userAgent,
        detectedFormat: format,
        totalVlessLinks,
        matchedTechnicalLinks: 0,
        selectedNodes: {},
        outputLinkCount: totalVlessLinks,
        warnings: [`TopoR database balancer failed open: ${reason}.`],
    };

    return {
        body: input.body,
        debugInfo,
    };
}

function formatSafeError(error: unknown): string {
    if (error instanceof Error) {
        const code = (error as Error & { code?: string }).code;

        return [code ? `code=${code}` : undefined, error.message].filter(Boolean).join(' ');
    }

    return String(error);
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
                    .map((matchingLine) => matchingLine.nodeRef.node.technicalHostName)
                    .filter((technicalHostName) => Boolean(technicalHostName)),
            ),
        );
        const accessResult = filterCandidatesByUserAccess({
            candidateTechnicalHostNames: subscriptionCandidateTechnicalHostNames,
            input,
            location,
        });
        const nodeStatusByTechnicalHostName = await buildNodeStatusByTechnicalHostName(
            input,
            location,
        );
        const activeCandidateTechnicalHostNames = filterActiveCandidateTechnicalHostNames(
            location,
            accessResult.effectiveCandidateTechnicalHostNames,
            nodeStatusByTechnicalHostName,
        );
        const previousAssignment = await findPreviousAssignment(
            input,
            location,
            nodeStatusByTechnicalHostName,
        );
        const reassignmentAttempted =
            previousAssignment?.status === 'disabled' ||
            previousAssignment?.status === 'dead' ||
            previousAssignment?.status === 'not_in_subscription';
        const excludedNodes = buildExcludedCandidateNodes({
            accessExcludedNodes: accessResult.excludedNodes,
            effectiveCandidateTechnicalHostNames: activeCandidateTechnicalHostNames,
            location,
            nodeStatusByTechnicalHostName,
            subscriptionCandidateTechnicalHostNames,
        });
        const warnings = [...accessResult.warnings];

        if (activeCandidateTechnicalHostNames.length === 0 && !canKeepPreviousAssignment(previousAssignment)) {
            const failOpenReason = buildFailOpenReason(previousAssignment);
            warnings.push(
                accessResult.effectiveCandidateTechnicalHostNames.length === 0
                    ? `No accessible TopoR balancer candidates for ${publicGroupKey}; preserving original links.`
                    : `No active TopoR balancer node for ${publicGroupKey}; preserving original links.`,
            );
            groupCandidateDiagnostics.push({
                publicHostCode: location.publicHostCode,
                planCode: location.planCode,
                userSquads: input.userAccess?.squads ?? [],
                accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
                groupNodesCount: location.nodes.length,
                subscriptionCandidateNodes: subscriptionCandidateTechnicalHostNames,
                effectiveCandidateNodes: [],
                excludedNodes,
                ...(previousAssignment
                    ? {
                          previousAssignedNode: previousAssignment.technicalHostName,
                          previousAssignedNodeStatus: previousAssignment.status,
                      }
                    : {}),
                reassignmentAttempted,
                reassignmentResult: reassignmentAttempted ? 'failed' : 'not_needed',
                failOpenReason,
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

        const reassignmentResult = buildReassignmentResult(
            previousAssignment,
            selectedNode,
            reassignmentAttempted,
        );
        const failOpenReason = selectedNode ? undefined : buildFailOpenReason(previousAssignment);

        groupCandidateDiagnostics.push({
            publicHostCode: location.publicHostCode,
            planCode: location.planCode,
            userSquads: input.userAccess?.squads ?? [],
            accessibleNodesCount: input.userAccess?.accessibleNodeUuids.length ?? 0,
            groupNodesCount: location.nodes.length,
            subscriptionCandidateNodes: subscriptionCandidateTechnicalHostNames,
            effectiveCandidateNodes: activeCandidateTechnicalHostNames,
            excludedNodes,
            ...(previousAssignment
                ? {
                      previousAssignedNode: previousAssignment.technicalHostName,
                      previousAssignedNodeStatus: previousAssignment.status,
                  }
                : {}),
            reassignmentAttempted,
            reassignmentResult,
            ...(selectedNode ? { selectedTechnicalHostName: selectedNode.technicalHostName } : {}),
            ...(failOpenReason ? { failOpenReason } : {}),
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
    excludedNodes: ExcludedCandidateNode[];
    warnings: string[];
} {
    if (
        (!input.input.topology || input.input.topology.hosts.length === 0) &&
        (!input.input.userAccess ||
            (input.input.userAccess.squads.length === 0 &&
                input.input.userAccess.accessibleNodeUuids.length === 0))
    ) {
        return {
            effectiveCandidateTechnicalHostNames: input.candidateTechnicalHostNames,
            excludedNodes: [],
            warnings: [],
        };
    }

    const userSquadUuids = new Set(input.input.userAccess?.squads.map((squad) => squad.uuid) ?? []);
    const userAccessibleNodeUuids = new Set(input.input.userAccess?.accessibleNodeUuids ?? []);
    const hostByRemark = new Map(
        (input.input.topology?.hosts ?? []).map((host) => [
            normalizeTechnicalHostName(host.remark),
            host,
        ]),
    );
    const warnings: string[] = [];
    const effectiveCandidateTechnicalHostNames: string[] = [];
    const excludedNodes: ExcludedCandidateNode[] = [];

    for (const technicalHostName of input.candidateTechnicalHostNames) {
        const host = hostByRemark.get(normalizeTechnicalHostName(technicalHostName));

        if (!host) {
            const message = `Candidate ${technicalHostName} has no Remnawave topology host; excluded for user-aware balancing.`;

            warnings.push(message);
            excludedNodes.push({
                technicalHostName,
                reason: 'missing_topology',
                message,
            });
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
                const message = `User is not in required squad ${input.location.internalSquadUuid} for ${getPublicGroupKey(input.location)}.`;

                warnings.push(message);
                excludedNodes.push({
                    technicalHostName,
                    reason: 'user_not_in_group_squad',
                    message,
                });
                continue;
            }

            if (!hostSquadUuids.has(input.location.internalSquadUuid)) {
                const message = `Candidate ${technicalHostName} is not accessible to required squad ${input.location.internalSquadUuid}; excluded.`;

                warnings.push(message);
                excludedNodes.push({
                    technicalHostName,
                    reason: 'not_accessible_to_group_squad',
                    message,
                });
                continue;
            }
        }

        if (userSquadUuids.size > 0 && userAccessibleNodeUuids.size > 0 && !isUserNodeAccessible) {
            const message = `Candidate ${technicalHostName} is not accessible to this user's squads; excluded.`;

            warnings.push(message);
            excludedNodes.push({
                technicalHostName,
                reason: 'not_accessible_to_user_squad',
                message,
            });
            continue;
        }

        effectiveCandidateTechnicalHostNames.push(technicalHostName);
    }

    return {
        effectiveCandidateTechnicalHostNames,
        excludedNodes,
        warnings,
    };
}

async function findPreviousAssignment(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    location: ToporBalancerLocation,
    nodeStatusByTechnicalHostName: Map<string, ToporBalancerNodeStatus>,
): Promise<{
    technicalHostName: string;
    status: ToporBalancerNodeStatus | 'not_in_subscription' | 'unknown';
} | null> {
    const assignments = await input.repository.listAssignments({
        shortUuid: input.shortUuid,
        publicHostCode: location.publicHostCode,
        planCode: location.planCode,
    });
    const previousAssignment = assignments[0];

    if (!previousAssignment) {
        return null;
    }

    const technicalHostName = previousAssignment.technicalHostName ?? previousAssignment.nodeId;
    const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName);
    const configuredNode = location.nodes.find(
        (node) => normalizeTechnicalHostName(node.technicalHostName) === normalizedTechnicalHostName,
    );

    return {
        technicalHostName,
        status:
            nodeStatusByTechnicalHostName.get(normalizedTechnicalHostName) ??
            configuredNode?.status ??
            'unknown',
    };
}

function canKeepPreviousAssignment(
    previousAssignment: Awaited<ReturnType<typeof findPreviousAssignment>>,
): boolean {
    return previousAssignment?.status === 'active' || previousAssignment?.status === 'draining';
}

function filterActiveCandidateTechnicalHostNames(
    location: ToporBalancerLocation,
    candidateTechnicalHostNames: string[],
    nodeStatusByTechnicalHostName: Map<string, ToporBalancerNodeStatus>,
): string[] {
    const candidateNames = new Set(candidateTechnicalHostNames.map(normalizeTechnicalHostName));

    return location.nodes
        .filter(
            (node) =>
                (nodeStatusByTechnicalHostName.get(normalizeTechnicalHostName(node.technicalHostName)) ??
                    node.status) === 'active' &&
                candidateNames.has(normalizeTechnicalHostName(node.technicalHostName)),
        )
        .map((node) => node.technicalHostName);
}

async function buildNodeStatusByTechnicalHostName(
    input: ProcessSubscriptionWithDatabaseBalancerInput,
    location: ToporBalancerLocation,
): Promise<Map<string, ToporBalancerNodeStatus>> {
    const nodes = await input.repository.listNodes();

    return new Map(
        nodes
            .filter(
                (node) =>
                    node.publicHostCode === location.publicHostCode &&
                    node.planCode === location.planCode,
            )
            .map((node) => [normalizeTechnicalHostName(node.technicalHostName), node.status]),
    );
}

function buildReassignmentResult(
    previousAssignment: Awaited<ReturnType<typeof findPreviousAssignment>>,
    selectedNode: ToporBalancerDbNode | null,
    reassignmentAttempted: boolean,
): 'kept' | 'reassigned' | 'failed' | 'not_needed' {
    if (!previousAssignment) {
        return 'not_needed';
    }

    if (!selectedNode) {
        return reassignmentAttempted ? 'failed' : 'not_needed';
    }

    if (
        normalizeTechnicalHostName(previousAssignment.technicalHostName) ===
        normalizeTechnicalHostName(selectedNode.technicalHostName)
    ) {
        return 'kept';
    }

    return reassignmentAttempted ? 'reassigned' : 'not_needed';
}

function buildFailOpenReason(
    previousAssignment: Awaited<ReturnType<typeof findPreviousAssignment>>,
): 'no_active_candidates' | 'node_dead' | 'node_disabled' | 'manual_strategy' {
    if (previousAssignment?.status === 'dead') {
        return 'node_dead';
    }

    if (previousAssignment?.status === 'disabled') {
        return 'node_disabled';
    }

    return 'no_active_candidates';
}

function buildExcludedCandidateNodes(input: {
    accessExcludedNodes: ExcludedCandidateNode[];
    effectiveCandidateTechnicalHostNames: string[];
    location: ToporBalancerLocation;
    nodeStatusByTechnicalHostName: Map<string, ToporBalancerNodeStatus>;
    subscriptionCandidateTechnicalHostNames: string[];
}): ExcludedCandidateNode[] {
    const excludedByName = new Map(
        input.accessExcludedNodes.map((node) => [node.technicalHostName, node]),
    );
    const subscriptionCandidateNames = new Set(
        input.subscriptionCandidateTechnicalHostNames.map(normalizeTechnicalHostName),
    );
    const effectiveCandidateNames = new Set(
        input.effectiveCandidateTechnicalHostNames.map(normalizeTechnicalHostName),
    );

    for (const node of input.location.nodes) {
        const normalizedTechnicalHostName = normalizeTechnicalHostName(node.technicalHostName);

        if (effectiveCandidateNames.has(normalizedTechnicalHostName)) {
            continue;
        }

        if (excludedByName.has(node.technicalHostName)) {
            continue;
        }

        if (!subscriptionCandidateNames.has(normalizedTechnicalHostName)) {
            excludedByName.set(node.technicalHostName, {
                technicalHostName: node.technicalHostName,
                reason: 'not_in_subscription',
                message: `Node ${node.technicalHostName} is in the Balancer group but is not present in this user's subscription response.`,
            });
            continue;
        }

        const nodeStatus =
            input.nodeStatusByTechnicalHostName.get(normalizedTechnicalHostName) ?? node.status;

        if (nodeStatus === 'disabled') {
            excludedByName.set(node.technicalHostName, {
                technicalHostName: node.technicalHostName,
                reason: 'node_disabled',
                message: `Node ${node.technicalHostName} is disabled and cannot receive assignments.`,
            });
            continue;
        }

        if (nodeStatus === 'dead') {
            excludedByName.set(node.technicalHostName, {
                technicalHostName: node.technicalHostName,
                reason: 'node_dead',
                message: `Node ${node.technicalHostName} is dead and must be reassigned.`,
            });
            continue;
        }

        if (nodeStatus === 'draining') {
            excludedByName.set(node.technicalHostName, {
                technicalHostName: node.technicalHostName,
                reason: 'node_draining',
                message: `Node ${node.technicalHostName} is draining and cannot receive new assignments.`,
            });
        }
    }

    return Array.from(excludedByName.values());
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

        const nodeRef = technicalNodeMap.get(normalizeTechnicalHostName(parsedLink.remark));

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

        if (
            normalizeTechnicalHostName(parsedLink.remark) !==
            normalizeTechnicalHostName(selectedNode.technicalHostName)
        ) {
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

function getRuntimeDiagnosticsStatus(debugInfo: ToporBalancerDebugInfo): string {
    const groups = debugInfo.groupCandidateDiagnostics ?? [];

    if (groups.some((group) => group.failOpenReason === 'no_active_candidates')) {
        return 'no_active_candidates';
    }

    if (groups.some((group) => group.effectiveCandidateNodes.length === 0)) {
        return 'no_effective_candidates';
    }

    if (groups.some((group) => group.failOpenReason)) {
        return 'failed_open';
    }

    if (debugInfo.matchedTechnicalLinks > 0 && Object.keys(debugInfo.selectedNodes).length === 0) {
        return 'passed_through';
    }

    if (groups.length > Object.keys(debugInfo.selectedNodes).length) {
        return 'partially_processed';
    }

    return Object.keys(debugInfo.selectedNodes).length > 0 ? 'processed' : 'passed_through';
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
