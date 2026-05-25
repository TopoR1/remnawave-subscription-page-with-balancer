import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import type {
    ToporBalancerAssignmentFilters,
    ToporBalancerAssignmentRepository,
    ToporBalancerAssignmentSelectionInput,
    ToporBalancerGroupCreateInput,
    ToporBalancerGroupDeleteResult,
    ToporBalancerGroupNodeCreateInput,
    ToporBalancerGroupUpdateInput,
    ToporBalancerManualReassignInput,
    ToporBalancerNodeCreateInput,
    ToporBalancerNodeDeleteResult,
    ToporBalancerNodeUpdateInput,
    ToporBalancerRequestLogInput,
    ToporBalancerRequestFilters,
} from './topor-balancer-database.repository';
import type {
    ToporBalancerAdminNode,
    ToporBalancerAdminGroup,
    ToporBalancerAdminRequest,
    ToporBalancerConfig,
    ToporBalancerDbAssignment,
    ToporBalancerDbNode,
    ToporBalancerGroupStrategy,
    ToporBalancerNode,
    ToporBalancerNodeStatus,
    ToporRemnawaveTopologySnapshot,
} from './types';

import {
    decodeSubscriptionBody,
    detectSubscriptionFormat,
    encodeSubscriptionBody,
    extractVlessLinks,
    parseSubscription,
    parseVlessLink,
    replaceVlessRemark,
} from './topor-balancer-subscription.parser';
import { buildMaskedVlessDiff } from './topor-balancer-subscription.diagnostics';
import {
    ToporBalancerConfigValidationError,
    validateToporBalancerConfig,
} from './topor-balancer-config.validator';
import { processSubscriptionWithDatabaseBalancer } from './topor-balancer-database.processor';
import { processSubscriptionWithHashBalancer } from './topor-balancer-hash.processor';
import { parseToporBalancerConfig } from './topor-balancer-config.loader';
import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerDiscoveryService } from './topor-balancer-discovery.service';
import { ToporBalancerService } from './topor-balancer.service';
import { AxiosService } from '../../common/axios';
import { checkAssetsCookieMiddleware } from '../../common/middlewares/check-assets-cookie.middleware';
import { RuntimeConfigService } from '../root/runtime-config.service';
import { IGNORED_HEADERS } from '../../common/constants';

const realityLink =
    'vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=reality&sni=www.microsoft.com&flow=xtls-rprx-vision&pbk=publicKeyValue&sid=abcd&fp=chrome#Finland';

const complexRealityLink =
    'vless://99999999-9999-4999-8999-999999999999@reality.example.com:443?type=tcp&security=reality&sni=www.cloudflare.com&fp=chrome&pbk=veryPublicRealityKeyValue&sid=1234abcd&flow=xtls-rprx-vision&path=%2Fgrpc&serviceName=grpc-service&alpn=h2%2Chttp%2F1.1#FI-STD-01';

const balancerConfig: ToporBalancerConfig = {
    enabled: true,
    locations: [
        {
            publicHostCode: 'fi_standard',
            publicName: '\u{1F1EB}\u{1F1EE} Finland',
            locationCode: 'FI',
            planCode: 'standard',
            nodes: [
                {
                    technicalHostName: 'FI-STD-01',
                    weight: 1,
                    maxUsers: 300,
                    status: 'active',
                },
                {
                    technicalHostName: 'FI-STD-02',
                    weight: 1,
                    maxUsers: 300,
                    status: 'active',
                },
                {
                    technicalHostName: 'FI-STD-03',
                    weight: 1,
                    maxUsers: 300,
                    status: 'active',
                },
            ],
        },
        {
            publicHostCode: 'de_standard',
            publicName: '\u{1F1E9}\u{1F1EA} Germany',
            locationCode: 'DE',
            planCode: 'standard',
            nodes: [
                {
                    technicalHostName: 'DE-STD-01',
                    weight: 1,
                    maxUsers: 300,
                    status: 'active',
                },
                {
                    technicalHostName: 'DE-STD-02',
                    weight: 1,
                    maxUsers: 300,
                    status: 'dead',
                },
            ],
        },
        {
            publicHostCode: 'fr_standard',
            publicName: 'France',
            locationCode: 'FR',
            planCode: 'standard',
            nodes: [
                {
                    technicalHostName: 'FR-STD-01',
                    weight: 1,
                    maxUsers: 300,
                    status: 'draining',
                },
            ],
        },
    ],
};

function buildVlessLink(remark: string): string {
    return (
        `vless://44444444-4444-4444-8444-444444444444@${remark.toLowerCase()}.example.com:443` +
        `?security=reality&type=tcp&sni=example.com&pbk=key&sid=sid#${remark}`
    );
}

function buildRemarkVlessLink(remark: string, index = 1): string {
    return (
        `vless://44444444-4444-4444-8444-${String(index).padStart(12, '0')}@node-${index}.example.com:443` +
        `?security=reality&type=tcp&sni=example.com&pbk=key&sid=sid#${encodeURIComponent(remark)}`
    );
}

function buildUnsupportedAppFallbackLink(): string {
    return (
        'vless://44444444-4444-4444-8444-444444444444@0.0.0.0:1' +
        '?security=reality&type=tcp&sni=example.com&pbk=key&sid=sid#App%20not%20supported'
    );
}

function buildStrategyConfig(
    strategy: ToporBalancerGroupStrategy,
    nodes: ToporBalancerNode[] = [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-03', weight: 1, maxUsers: 300, status: 'active' },
    ],
): ToporBalancerConfig {
    return {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi_standard',
                publicName: '\u{1F1EB}\u{1F1EE} Finland',
                locationCode: 'FI',
                planCode: 'standard',
                strategy,
                nodes,
            },
        ],
    };
}

function buildRuntimeTopology(): ToporRemnawaveTopologySnapshot {
    return {
        hosts: [
            {
                uuid: 'standard-host',
                remark: 'FI-STD-01',
                nodeUuid: 'standard-node',
                nodeName: 'Standard node',
                accessibleSquads: [{ uuid: 'standard-squad', name: 'Standard' }],
            },
            {
                uuid: 'game-host',
                remark: 'FI-GAME-01',
                nodeUuid: 'game-node',
                nodeName: 'Game node',
                accessibleSquads: [{ uuid: 'game-squad', name: 'Game' }],
            },
        ],
        inbounds: [],
        nodes: [
            { uuid: 'standard-node', name: 'Standard node' },
            { uuid: 'game-node', name: 'Game node' },
        ],
        squads: [
            { uuid: 'standard-squad', name: 'Standard' },
            { uuid: 'game-squad', name: 'Game' },
        ],
        warnings: [],
    };
}

test('parses VLESS REALITY link', () => {
    const parsedLink = parseVlessLink(realityLink);

    assert.ok(parsedLink);
    assert.equal(parsedLink.raw, realityLink);
    assert.equal(parsedLink.protocol, 'vless');
    assert.equal(parsedLink.uuid, '11111111-1111-4111-8111-111111111111');
    assert.equal(parsedLink.host, 'example.com');
    assert.equal(parsedLink.port, 443);
    assert.equal(parsedLink.security, 'reality');
    assert.equal(parsedLink.type, 'tcp');
    assert.equal(parsedLink.sni, 'www.microsoft.com');
    assert.equal(parsedLink.flow, 'xtls-rprx-vision');
    assert.equal(parsedLink.pbk, 'publicKeyValue');
    assert.equal(parsedLink.sid, 'abcd');
    assert.equal(parsedLink.queryParams.fp, 'chrome');
    assert.equal(
        parsedLink.rawQuery,
        'type=tcp&security=reality&sni=www.microsoft.com&flow=xtls-rprx-vision&pbk=publicKeyValue&sid=abcd&fp=chrome',
    );
});

test('parses VLESS link with encoded remark and replaces remark conservatively', () => {
    const link =
        'vless://22222222-2222-4222-8222-222222222222@[2001:db8::1]:8443?security=none&type=ws&path=%2Fws#%F0%9F%87%AB%F0%9F%87%AE%20Finland%201';
    const parsedLink = parseVlessLink(link);
    const replacedLink = replaceVlessRemark(link, 'TopoR Finland');

    assert.ok(parsedLink);
    assert.equal(parsedLink.host, '[2001:db8::1]');
    assert.equal(parsedLink.port, 8443);
    assert.equal(parsedLink.remark, '\u{1F1EB}\u{1F1EE} Finland 1');
    assert.equal(
        replacedLink,
        'vless://22222222-2222-4222-8222-222222222222@[2001:db8::1]:8443?security=none&type=ws&path=%2Fws#TopoR%20Finland',
    );
});

test('round-trips VLESS REALITY link and preserves all fields except remark', () => {
    const replacedLink = replaceVlessRemark(complexRealityLink, '\u{1F1EB}\u{1F1EE} Finland');
    const originalBeforeRemark = complexRealityLink.slice(0, complexRealityLink.indexOf('#'));
    const replacedBeforeRemark = replacedLink.slice(0, replacedLink.indexOf('#'));
    const parsedOriginal = parseVlessLink(complexRealityLink);
    const parsedReplaced = parseVlessLink(replacedLink);

    assert.ok(parsedOriginal);
    assert.ok(parsedReplaced);
    assert.equal(replacedBeforeRemark, originalBeforeRemark);
    assert.equal(parsedReplaced.uuid, parsedOriginal.uuid);
    assert.equal(parsedReplaced.host, parsedOriginal.host);
    assert.equal(parsedReplaced.port, parsedOriginal.port);
    assert.equal(parsedReplaced.rawQuery, parsedOriginal.rawQuery);
    assert.equal(parsedReplaced.remark, '\u{1F1EB}\u{1F1EE} Finland');
});

test('preserves VLESS REALITY and transport parameters during remark replacement', () => {
    const replacedLink = replaceVlessRemark(complexRealityLink, 'Finland Public');
    const parsedLink = parseVlessLink(replacedLink);

    assert.ok(parsedLink);
    assert.equal(parsedLink.security, 'reality');
    assert.equal(parsedLink.sni, 'www.cloudflare.com');
    assert.equal(parsedLink.fp, 'chrome');
    assert.equal(parsedLink.pbk, 'veryPublicRealityKeyValue');
    assert.equal(parsedLink.sid, '1234abcd');
    assert.equal(parsedLink.flow, 'xtls-rprx-vision');
    assert.equal(parsedLink.type, 'tcp');
    assert.equal(parsedLink.path, '/grpc');
    assert.equal(parsedLink.serviceName, 'grpc-service');
    assert.equal(parsedLink.alpn, 'h2,http/1.1');
});

test('unsafe remark replacement fails open to the original VLESS link', () => {
    const invalidUnicodeRemark = '\uD800';

    assert.equal(replaceVlessRemark(complexRealityLink, invalidUnicodeRemark), complexRealityLink);
});

test('extracts multiple links with empty lines', () => {
    const secondLink =
        'vless://33333333-3333-4333-8333-333333333333@example.net:443?security=tls&type=tcp#Second';
    const body = `\n${realityLink}\n\n${secondLink}\n`;
    const parsedSubscription = parseSubscription(body);

    assert.equal(detectSubscriptionFormat(body), 'plain_links');
    assert.equal(parsedSubscription.format, 'plain_links');
    assert.equal(parsedSubscription.links.length, 2);
    assert.deepEqual(
        extractVlessLinks(body).map((link) => link.remark),
        ['Finland', 'Second'],
    );
});

test('detects, decodes, and encodes base64 subscription', () => {
    const plainBody = `${realityLink}\n`;
    const base64Body = Buffer.from(plainBody, 'utf8').toString('base64');

    assert.equal(detectSubscriptionFormat(base64Body), 'base64_links');
    assert.equal(decodeSubscriptionBody(base64Body, 'base64_links'), plainBody);
    assert.equal(encodeSubscriptionBody(plainBody, 'base64_links'), base64Body);
});

test('detects unpadded base64 subscription and decodes valid VLESS links', () => {
    const plainBody = `${complexRealityLink}\n`;
    const base64Body = Buffer.from(plainBody, 'utf8').toString('base64').replace(/=+$/, '');

    assert.equal(detectSubscriptionFormat(base64Body), 'base64_links');
    assert.equal(decodeSubscriptionBody(base64Body, 'base64_links'), plainBody);
});

test('safely ignores invalid or malformed VLESS link', () => {
    const malformedLink = 'vless://not-a-valid-link';
    const nonVlessLink = 'https://example.com/subscription';

    assert.equal(parseVlessLink(malformedLink), null);
    assert.equal(replaceVlessRemark(malformedLink, 'New Remark'), malformedLink);
    assert.equal(parseVlessLink(nonVlessLink), null);
    assert.equal(replaceVlessRemark(nonVlessLink, 'New Remark'), nonVlessLink);
    assert.equal(detectSubscriptionFormat(malformedLink), 'unknown');
});

test('safely ignores HTML body', () => {
    const htmlBody = '<!doctype html><html><body>subscription page</body></html>';

    assert.equal(detectSubscriptionFormat(htmlBody, 'text/html; charset=utf-8'), 'html');
    assert.equal(decodeSubscriptionBody(htmlBody, 'html'), htmlBody);
    assert.equal(encodeSubscriptionBody('changed', 'html', htmlBody), htmlBody);
});

test('safely ignores JSON body', () => {
    const jsonBody = '{"links":["vless://not-parsed-here"]}';

    assert.equal(detectSubscriptionFormat(jsonBody, 'application/json'), 'json');
    assert.equal(parseSubscription(jsonBody, 'application/json').links.length, 0);
});

test('hash balancer keeps one active technical node per public host and renames remarks', () => {
    const body = [
        buildVlessLink('FI-STD-01'),
        '',
        buildVlessLink('FI-STD-02'),
        buildVlessLink('FI-STD-03'),
        buildVlessLink('DE-STD-01'),
        buildVlessLink('DE-STD-02'),
        buildVlessLink('FR-STD-01'),
        buildVlessLink('UNKNOWN-STD-01'),
    ].join('\n');
    const logs: string[] = [];
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body,
        contentType: 'text/plain',
        config: balancerConfig,
        debug: true,
        logger: (message) => logs.push(message),
    });
    const parsedOutput = parseSubscription(result.body);
    const outputRemarks = parsedOutput.links.map((link) => link.remark);

    assert.equal(result.debugInfo.detectedFormat, 'plain_links');
    assert.equal(result.debugInfo.totalVlessLinks, 7);
    assert.equal(result.debugInfo.matchedTechnicalLinks, 6);
    assert.equal(Object.keys(result.debugInfo.selectedNodes).length, 2);
    assert.ok(result.debugInfo.selectedNodes['fi_standard:standard'].startsWith('FI-STD-'));
    assert.equal(result.debugInfo.selectedNodes['de_standard:standard'], 'DE-STD-01');
    assert.equal(result.debugInfo.outputLinkCount, 4);
    assert.equal(parsedOutput.links.length, 4);
    assert.ok(outputRemarks.includes('\u{1F1EB}\u{1F1EE} Finland'));
    assert.ok(outputRemarks.includes('\u{1F1E9}\u{1F1EA} Germany'));
    assert.ok(outputRemarks.includes('FR-STD-01'));
    assert.ok(outputRemarks.includes('UNKNOWN-STD-01'));
    assert.equal(outputRemarks.includes('DE-STD-02'), false);
    assert.ok(
        result.debugInfo.warnings?.includes(
            'No active TopoR balancer node for fr_standard:standard; preserving original links.',
        ),
    );
    assert.equal(logs.length, 2);
    assert.match(logs[0], /\[TOPOR_BALANCER_DEBUG\]/);
    assert.match(logs[1], /\[TOPOR_BALANCER_WARNING\]/);
});

test('hash balancer processes same publicHostCode with different planCode independently', () => {
    const config: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi',
                publicName: 'Finland Standard',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'FI-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                    {
                        technicalHostName: 'FI-STD-02',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'fi',
                publicName: 'Finland Game',
                locationCode: 'FI',
                planCode: 'game',
                nodes: [
                    {
                        technicalHostName: 'FI-GAME-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                    {
                        technicalHostName: 'FI-GAME-02',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const body = [
        buildVlessLink('FI-STD-01'),
        buildVlessLink('FI-STD-02'),
        buildVlessLink('FI-GAME-01'),
        buildVlessLink('FI-GAME-02'),
    ].join('\n');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'same-public-host',
        body,
        config,
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.equal(Object.keys(result.debugInfo.selectedNodes).length, 2);
    assert.ok(result.debugInfo.selectedNodes['fi:standard']);
    assert.ok(result.debugInfo.selectedNodes['fi:game']);
    assert.equal(outputRemarks.includes('Finland Standard'), true);
    assert.equal(outputRemarks.includes('Finland Game'), true);
    assert.equal(outputRemarks.length, 2);
});

test('technicalHostName matching normalizes emoji, NFC, trailing and non-breaking spaces', () => {
    const config: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi_standard',
                publicName: 'Finland Standard Public',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '🇫🇮 Финляндия',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'accent_standard',
                publicName: 'Cafe Public',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'Café',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'space_standard',
                publicName: 'Space Public',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'Node Name',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const body = [
        buildRemarkVlessLink('🇫🇮 Финляндия', 1),
        buildRemarkVlessLink('Cafe\u0301', 2),
        buildRemarkVlessLink('🇫🇮 Финляндия ', 3),
        buildRemarkVlessLink('Node\u00A0Name', 4),
        buildRemarkVlessLink('🇷🇺 Россия', 5),
    ].join('\n');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'unicode-user',
        body,
        config,
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.equal(result.debugInfo.matchedTechnicalLinks, 4);
    assert.equal(outputRemarks.includes('Finland Standard Public'), true);
    assert.equal(outputRemarks.includes('Cafe Public'), true);
    assert.equal(outputRemarks.includes('Space Public'), true);
    assert.equal(outputRemarks.includes('🇷🇺 Россия'), true);
});

test('technicalHostName matching keeps Finland standard and game distinct', () => {
    const config: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi_standard',
                publicName: 'Finland Standard Public',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '🇫🇮 Финляндия',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'fi_game',
                publicName: 'Finland Game Public',
                locationCode: 'FI',
                planCode: 'game',
                nodes: [
                    {
                        technicalHostName: '🇫🇮 Финляндия (Game)',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const body = [
        buildRemarkVlessLink('🇫🇮 Финляндия', 1),
        buildRemarkVlessLink('🇫🇮 Финляндия (Game)', 2),
    ].join('\n');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'distinct-user',
        body,
        config,
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.deepEqual(result.debugInfo.selectedNodes, {
        'fi_standard:standard': '🇫🇮 Финляндия',
        'fi_game:game': '🇫🇮 Финляндия (Game)',
    });
    assert.equal(outputRemarks.includes('Finland Standard Public'), true);
    assert.equal(outputRemarks.includes('Finland Game Public'), true);
});

test('hash balancer preserves original links when no active node exists', () => {
    const body = [
        buildVlessLink('DE-STD-01'),
        buildVlessLink('DE-STD-02'),
        buildVlessLink('FR-STD-01'),
    ].join('\n');
    const disabledConfig: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'de_standard',
                publicName: 'Germany',
                locationCode: 'DE',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'DE-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'disabled',
                    },
                    {
                        technicalHostName: 'DE-STD-02',
                        weight: 1,
                        maxUsers: 300,
                        status: 'dead',
                    },
                ],
            },
            {
                publicHostCode: 'fr_standard',
                publicName: 'France',
                locationCode: 'FR',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'FR-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'draining',
                    },
                ],
            },
        ],
    };
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'no-active',
        body,
        config: disabledConfig,
    });

    assert.equal(result.body, body);
    assert.deepEqual(result.debugInfo.selectedNodes, {});
    assert.deepEqual(result.debugInfo.warnings, [
        'No active TopoR balancer node for de_standard:standard; preserving original links.',
        'No active TopoR balancer node for fr_standard:standard; preserving original links.',
    ]);
});

test('hash balancer is sticky for the same shortUuid and public host', () => {
    const body = [
        buildVlessLink('FI-STD-01'),
        buildVlessLink('FI-STD-02'),
        buildVlessLink('FI-STD-03'),
    ].join('\n');
    const firstResult = processSubscriptionWithHashBalancer({
        shortUuid: 'sticky-user',
        body,
        config: balancerConfig,
    });
    const secondResult = processSubscriptionWithHashBalancer({
        shortUuid: 'sticky-user',
        body,
        config: balancerConfig,
    });

    assert.deepEqual(firstResult.debugInfo.selectedNodes, secondResult.debugInfo.selectedNodes);
    assert.equal(firstResult.body, secondResult.body);
});

test('hash balancer supports base64 subscriptions', () => {
    const plainBody = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const base64Body = Buffer.from(plainBody, 'utf8').toString('base64');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body: base64Body,
        config: balancerConfig,
    });
    const decodedOutput = decodeSubscriptionBody(result.body, 'base64_links');
    const parsedOutput = parseSubscription(decodedOutput);

    assert.equal(detectSubscriptionFormat(result.body), 'base64_links');
    assert.equal(result.debugInfo.detectedFormat, 'base64_links');
    assert.equal(parsedOutput.links.length, 1);
    assert.equal(parsedOutput.links[0].remark, '\u{1F1EB}\u{1F1EE} Finland');
});

test('hash balancer supports unpadded base64 subscriptions with valid VLESS output', () => {
    const plainBody = [complexRealityLink, buildVlessLink('FI-STD-02')].join('\n');
    const base64Body = Buffer.from(plainBody, 'utf8').toString('base64').replace(/=+$/, '');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body: base64Body,
        config: balancerConfig,
    });
    const decodedOutput = decodeSubscriptionBody(result.body, 'base64_links');
    const parsedOutput = parseSubscription(decodedOutput);

    assert.equal(detectSubscriptionFormat(result.body), 'base64_links');
    assert.equal(parsedOutput.links.length, 1);
    assert.ok(parseVlessLink(parsedOutput.links[0].raw));
});

test('hash balancer creates URL-safe emoji publicName remarks', () => {
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body: [complexRealityLink, buildVlessLink('FI-STD-02')].join('\n'),
        config: balancerConfig,
    });
    const parsedOutput = parseSubscription(result.body);

    assert.equal(parsedOutput.links.length, 1);
    assert.equal(parsedOutput.links[0].remark, '\u{1F1EB}\u{1F1EE} Finland');
    assert.ok(new URL(parsedOutput.links[0].raw));
});

test('hash balancer preserves unknown and non-VLESS lines around valid output', () => {
    const body = ['# comment', 'trojan://example', complexRealityLink, 'metadata=keep'].join('\n');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body,
        config: balancerConfig,
    });

    assert.ok(result.body.includes('# comment'));
    assert.ok(result.body.includes('trojan://example'));
    assert.ok(result.body.includes('metadata=keep'));
    assert.equal(parseSubscription(result.body).links.length, 1);
});

test('hash balancer selected VLESS link differs only by public remark', () => {
    const singleNodeConfig: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi_standard',
                publicName: '\u{1F1EB}\u{1F1EE} Finland',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'FI-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body: complexRealityLink,
        config: singleNodeConfig,
    });
    const diff = buildMaskedVlessDiff(complexRealityLink, result.body);

    assert.equal(diff.length, 1);
    assert.deepEqual(diff[0].changedFields, ['remark']);
    assert.equal(parseSubscription(result.body).links[0].pbk, 'veryPublicRealityKeyValue');
    assert.equal(parseSubscription(result.body).links[0].sid, '1234abcd');
});

test('subscription response headers do not forward stale content-encoding', () => {
    assert.equal(IGNORED_HEADERS.has('content-encoding'), true);
    assert.equal(IGNORED_HEADERS.has('content-length'), true);
    assert.equal(IGNORED_HEADERS.has('transfer-encoding'), true);
});

test('hash balancer leaves HTML and JSON bodies unchanged', () => {
    const htmlBody = '<!doctype html><html><body>subscription page</body></html>';
    const jsonBody = '{"links":[]}';

    assert.equal(
        processSubscriptionWithHashBalancer({
            shortUuid: 'abc123',
            body: htmlBody,
            contentType: 'text/html',
            config: balancerConfig,
        }).body,
        htmlBody,
    );
    assert.equal(
        processSubscriptionWithHashBalancer({
            shortUuid: 'abc123',
            body: jsonBody,
            contentType: 'application/json',
            config: balancerConfig,
        }).body,
        jsonBody,
    );
});

test('hash balancer includes request path and user-agent in debug info', () => {
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const result = processSubscriptionWithHashBalancer({
        shortUuid: 'abc123',
        body,
        requestPath: '/abc123',
        userAgent: 'UnitTest/1.0',
        config: balancerConfig,
    });

    assert.equal(result.debugInfo.requestPath, '/abc123');
    assert.equal(result.debugInfo.userAgent, 'UnitTest/1.0');
});

test('config validator rejects missing required fields and invalid node values', () => {
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicName: 'Finland',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-STD-01',
                            },
                        ],
                    },
                ],
            }),
        /publicHostCode is required/,
    );
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-STD-01',
                            },
                        ],
                    },
                ],
            }),
        /publicName is required/,
    );
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland',
                        nodes: [
                            {
                                technicalHostName: 'FI-STD-01',
                            },
                        ],
                    },
                ],
            }),
        /planCode is required/,
    );
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland',
                        planCode: 'standard',
                        nodes: [{}],
                    },
                ],
            }),
        /technicalHostName is required/,
    );
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-STD-01',
                                status: 'broken',
                                weight: 0,
                                maxUsers: 0,
                            },
                        ],
                    },
                ],
            }),
        /weight must be a positive integer.*maxUsers must be a positive integer.*status must be one of/s,
    );
});

test('config validator rejects unsafe duplicates', () => {
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland Standard',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-01',
                            },
                        ],
                    },
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland Standard Duplicate',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-02',
                            },
                        ],
                    },
                ],
            }),
        /duplicates publicHostCode \+ planCode/,
    );
    assert.throws(
        () =>
            validateToporBalancerConfig({
                locations: [
                    {
                        publicHostCode: 'fi',
                        publicName: 'Finland',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-01',
                            },
                        ],
                    },
                    {
                        publicHostCode: 'de',
                        publicName: 'Germany',
                        planCode: 'standard',
                        nodes: [
                            {
                                technicalHostName: 'FI-01',
                            },
                        ],
                    },
                ],
            }),
        /duplicates locations\[0\]\.nodes\[0\]\.technicalHostName/,
    );
});

test('config loader rejects invalid JSON', () => {
    assert.throws(() => parseToporBalancerConfig('{not-json'), SyntaxError);
    assert.throws(() => validateToporBalancerConfig(null), ToporBalancerConfigValidationError);
});

test('ToporBalancerService returns the original body when disabled', async () => {
    const originalBody = { links: [] };
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: false,
            TOPOR_BALANCER_DEBUG: false,
            TOPOR_BALANCER_CONFIG_PATH: '/does/not/matter.json',
        }),
    );

    const result = await service.process({
        shortUuid: 'abc123',
        body: originalBody,
        contentType: 'application/json',
        requestPath: '/abc123',
        userAgent: 'UnitTest/1.0',
    });

    assert.equal(result, originalBody);
});

test('ToporBalancerService fails open when enabled processing throws', async () => {
    const originalBody = buildVlessLink('FI-STD-01');
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_DEBUG: false,
            TOPOR_BALANCER_CONFIG_PATH: '/missing/topor-balancer.config.json',
        }),
    );

    const result = await service.process({
        shortUuid: 'abc123',
        body: originalBody,
        contentType: 'text/plain',
        requestPath: '/abc123',
        userAgent: 'UnitTest/1.0',
    });

    assert.equal(result, originalBody);
});

test('subscription diagnostics validates generated VLESS links without exposing secrets', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const diagnosticBody = [
        'vless://44444444-4444-4444-8444-444444444444@fi.example.com:443?security=reality&type=tcp&sni=example.com&fp=chrome&pbk=secret-public-key&sid=abcd#FI-STD-01',
        'vless://55555555-5555-4555-8555-555555555555@de.example.com:443?security=reality&type=tcp&sni=example.com&fp=chrome&pbk=secret-public-key&sid=abcd#DE-STD-01',
    ].join('\n');
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscription: async () => ({
                response: Buffer.from(diagnosticBody, 'utf8').toString('base64'),
                headers: {
                    'content-type': 'text/plain',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);
    await repository.replaceRemnawaveTopologyCache({
        hosts: [
            {
                uuid: 'fi-host',
                remark: 'FI-STD-01',
                nodeUuid: 'fi-node',
                accessibleSquads: [{ uuid: 'standard-squad', name: 'Standard' }],
            },
            {
                uuid: 'de-host',
                remark: 'DE-STD-01',
                nodeUuid: 'de-node',
                accessibleSquads: [{ uuid: 'standard-squad', name: 'Standard' }],
            },
        ],
        inbounds: [],
        nodes: [
            { uuid: 'fi-node', name: 'FI' },
            { uuid: 'de-node', name: 'DE' },
        ],
        squads: [{ uuid: 'standard-squad', name: 'Standard' }],
        warnings: [],
    });

    const result = await service.diagnoseSubscription({
        shortUuid: 'diagnostic-user',
        userAgent: 'v2RayTun/6.0',
    });
    const serializedResult = JSON.stringify(result);

    assert.equal(result.ok, true);
    assert.equal(result.format, 'base64_links');
    assert.equal(result.inputLinksCount, 2);
    assert.equal(result.outputLinksCount, 2);
    assert.equal(result.groups.find((group) => group.publicHostCode === 'fi_standard')?.status, 'ok');
    assert.equal(result.vlessValidation.every((item) => item.valid), true);
    assert.ok(!serializedResult.includes('44444444-4444-4444-8444-444444444444'));
    assert.ok(!serializedResult.includes('secret-public-key'));
    assert.ok(!serializedResult.includes('sid=abcd'));
});

test('subscription diagnostics explains unmatched remarks and normalized technicalHostName comparison', async () => {
    const config: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'de_standard',
                publicName: '🇩🇪 Германия',
                locationCode: 'DE',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '🇩🇪 Германия',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'fi_standard',
                publicName: '🇫🇮 ФинляндияРРРР',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '🇫🇮 Финляндия',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'nl_standard',
                publicName: '🇳🇱 Нидерланды',
                locationCode: 'NL',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '🇳🇱 Нидерланды',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const diagnosticBody = [
        buildRemarkVlessLink('🇩🇪 Германия', 1),
        buildRemarkVlessLink('🇫🇮 Финляндия', 2),
        buildRemarkVlessLink('🇳🇱 Нидерланды', 3),
        buildRemarkVlessLink('🇷🇺 Россия', 4),
    ].join('\n');
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscription: async () => ({
                response: diagnosticBody,
                headers: {
                    'content-type': 'text/plain',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);

    const result = await service.diagnoseSubscription({
        shortUuid: 'diagnostic-russian-user',
        userAgent: 'v2raytun/windows',
    });
    const outputRemarks = result.matchedGroups.flatMap((group) => group.outputRemarks);
    const russiaDiagnostic = result.linkDiagnostics.find(
        (diagnostic) => diagnostic.visibleRemark === '🇷🇺 Россия',
    );
    const finlandGroup = result.matchedGroups.find(
        (group) => group.publicHostCode === 'fi_standard',
    );

    assert.equal(result.totalVlessLinks, 4);
    assert.equal(result.matchedTechnicalLinks, 3);
    assert.deepEqual(result.unmatchedRemarks, ['🇷🇺 Россия']);
    assert.equal(result.matchedGroups.length, 3);
    assert.ok(finlandGroup);
    assert.equal(finlandGroup.outputContainsPublicName, true);
    assert.equal(outputRemarks.includes('🇫🇮 ФинляндияРРРР'), true);
    assert.ok(russiaDiagnostic);
    assert.equal(russiaDiagnostic.matchesTechnicalHostName, false);
    assert.equal(russiaDiagnostic.normalizedRemark, '🇷🇺 Россия');
    assert.equal(russiaDiagnostic.reason, 'exact_mismatch');
    assert.equal(
        russiaDiagnostic.closestTechnicalHostNameCandidates.includes('🇫🇮 Финляндия'),
        true,
    );
});

test('subscription diagnostics reports invalid generated VLESS links', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscription: async () => ({
                response: buildVlessLink('FI-STD-01'),
                headers: {
                    'content-type': 'text/plain',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);

    const result = await service.diagnoseSubscription({
        shortUuid: 'diagnostic-user',
        userAgent: 'v2rayNG/1.9.0',
    });

    assert.equal(result.ok, false);
    assert.equal(result.vlessValidation[0].valid, false);
    assert.ok(result.vlessValidation[0].warnings.some((warning) => warning.includes('fp')));
    assert.ok(result.errors.some((error) => error.includes('Некорректная VLESS-ссылка')));
});

test('subscription diagnostics reports passed through when technicalHostName does not match', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscription: async () => ({
                response: buildVlessLink('REMNAWAVE-OLD-REMARK'),
                headers: {
                    'content-type': 'text/plain',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);

    const result = await service.diagnoseSubscription({
        shortUuid: 'diagnostic-unmatched-user',
        userAgent: 'v2rayNG/1.9.0',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'passed_through');
    assert.equal(result.format, 'plain_links');
    assert.equal(result.totalVlessLinks, 1);
    assert.equal(result.matchedTechnicalLinks, 0);
    assert.equal(result.rewrittenLinksCount, 0);
    assert.equal(result.unchangedLinksCount, 1);
    assert.deepEqual(result.unmatchedRemarks, ['REMNAWAVE-OLD-REMARK']);
    assert.equal(result.reasons[0].reason, 'exact_mismatch');
    assert.equal(result.linkDiagnostics[0].reason, 'exact_mismatch');
    assert.ok(
        result.warnings.some((warning) =>
            warning.includes('Не найдено совпадений technicalHostName'),
        ),
    );
});

test('subscription diagnostics detects unsupported app fallback without technicalHostName suggestions', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscription: async () => ({
                response: buildUnsupportedAppFallbackLink(),
                headers: {
                    'content-type': 'text/plain',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);

    const result = await service.diagnoseSubscription({
        shortUuid: 'unsupported-app-user',
        userAgent: 'UnknownClient/1.0',
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'unsupported_app');
    assert.equal(result.totalVlessLinks, 1);
    assert.equal(result.matchedTechnicalLinks, 0);
    assert.deepEqual(result.unmatchedRemarks, []);
    assert.equal(result.linkDiagnostics[0].visibleRemark, 'App not supported');
    assert.equal(result.linkDiagnostics[0].reason, 'unsupported_app');
    assert.equal(result.linkDiagnostics[0].closestTechnicalHostNameCandidates.length, 0);
    assert.equal(repository.assignments.size, 0);
    assert.equal(
        result.warnings.some((warning) =>
            warning.includes('Добавьте') || warning.includes('Add these remarks'),
        ),
        false,
    );
    assert.equal(
        result.warnings.some((warning) =>
            warning.includes('Remnawave вернул заглушку App not supported'),
        ),
        true,
    );
});

test('trace-subscription reports unsupported app fallback without assignment or suggestions', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
        ({
            getSubscriptionWithTrace: async (
                _clientIp: string,
                _shortUuid: string,
                headers: Record<string, string>,
            ) => ({
                response: buildUnsupportedAppFallbackLink(),
                headers: {
                    'content-type': 'text/plain',
                },
                trace: {
                    endpointType: 'getSubscription',
                    outgoingUserAgent: headers['user-agent'],
                    path: 'api/sub/trace-user',
                },
            }),
        } as unknown) as AxiosService,
    );

    setServiceRepository(service, repository);

    const result = await service.traceSubscription({
        shortUuid: 'trace-user',
        headers: {
            'user-agent': 'v2raytun/windows',
            accept: '*/*',
        },
    });

    assert.equal(result.upstream.outgoingUserAgent, 'v2raytun/windows');
    assert.equal(result.upstream.vlessLinksCount, 1);
    assert.equal(result.upstream.unsupportedAppFallback, true);
    assert.equal(result.balancer.status, 'unsupported_app');
    assert.equal(result.balancer.inputLinksCount, 1);
    assert.equal(result.balancer.matchedTechnicalLinks, 0);
    assert.deepEqual(result.balancer.unmatchedRemarks, []);
    assert.equal(result.output.unsupportedAppFallback, true);
    assert.equal(repository.assignments.size, 0);
});

test('database balancer creates a new assignment', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-new',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(Object.keys(result.debugInfo.selectedNodes).length, 1);
    assert.equal(repository.assignments.size, 1);
    assert.equal(parseSubscription(result.body).links.length, 1);
});

test('database balancer excludes nodes not accessible to the runtime user squad', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-GAME-01', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-GAME-01')].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'standard-user',
        body,
        config,
        repository,
        topology: buildRuntimeTopology(),
        userAccess: {
            squads: [{ uuid: 'standard-squad', name: 'Standard' }],
            accessibleNodeUuids: ['standard-node'],
        },
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.deepEqual(outputRemarks, ['\u{1F1EB}\u{1F1EE} Finland']);
    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-01');
    assert.deepEqual(
        result.debugInfo.groupCandidateDiagnostics?.[0]?.effectiveCandidateNodes,
        ['FI-STD-01'],
    );
    assert.ok(
        result.debugInfo.warnings?.some((warning) =>
            warning.includes('FI-GAME-01 is not accessible'),
        ),
    );
});

test('database balancer diagnostics show group nodes excluded from this subscription', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'one-visible-node-user',
        body: buildVlessLink('FI-STD-01'),
        config,
        repository,
    });
    const diagnostic = result.debugInfo.groupCandidateDiagnostics?.[0];

    assert.deepEqual(diagnostic?.subscriptionCandidateNodes, ['FI-STD-01']);
    assert.deepEqual(diagnostic?.effectiveCandidateNodes, ['FI-STD-01']);
    assert.equal(diagnostic?.groupNodesCount, 2);
    assert.deepEqual(diagnostic?.excludedNodes, [
        {
            technicalHostName: 'FI-STD-02',
            reason: 'not_in_subscription',
            message: "Node FI-STD-02 is in the Balancer group but is not present in this user's subscription response.",
        },
    ]);
});

test('database balancer passes through a group when user has no accessible candidates', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-GAME-01', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = buildVlessLink('FI-GAME-01');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'standard-user-no-game',
        body,
        config,
        repository,
        topology: buildRuntimeTopology(),
        userAccess: {
            squads: [{ uuid: 'standard-squad', name: 'Standard' }],
            accessibleNodeUuids: ['standard-node'],
        },
    });

    assert.equal(result.body, body);
    assert.deepEqual(result.debugInfo.selectedNodes, {});
    assert.deepEqual(result.debugInfo.groupCandidateDiagnostics?.[0]?.effectiveCandidateNodes, []);
    assert.ok(
        result.debugInfo.warnings?.some((warning) =>
            warning.includes('No accessible TopoR balancer candidates'),
        ),
    );
});

test('database balancer treats subscription-present nodes as accessible when user squads are empty', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = buildVlessLink('FI-STD-01');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'empty-squads-user',
        body,
        config,
        repository,
        topology: buildRuntimeTopology(),
        userAccess: {
            squads: [],
            accessibleNodeUuids: [],
        },
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-01');
    assert.equal(parseSubscription(result.body).links[0].remark, '\u{1F1EB}\u{1F1EE} Finland');
    assert.equal(
        result.debugInfo.groupCandidateDiagnostics?.[0]?.excludedNodes.some(
            (node) => node.reason === 'not_accessible_to_user_squad',
        ),
        false,
    );
});

test('database balancer processes same publicHostCode with different planCode independently', async () => {
    const config: ToporBalancerConfig = {
        enabled: true,
        locations: [
            {
                publicHostCode: 'fi',
                publicName: 'Finland Standard',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'FI-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                    {
                        technicalHostName: 'FI-STD-02',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
            {
                publicHostCode: 'fi',
                publicName: 'Finland Game',
                locationCode: 'FI',
                planCode: 'game',
                nodes: [
                    {
                        technicalHostName: 'FI-GAME-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                    {
                        technicalHostName: 'FI-GAME-02',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            },
        ],
    };
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [
        buildVlessLink('FI-STD-01'),
        buildVlessLink('FI-STD-02'),
        buildVlessLink('FI-GAME-01'),
        buildVlessLink('FI-GAME-02'),
    ].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'same-public-host-db',
        body,
        config,
        repository,
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.equal(Object.keys(result.debugInfo.selectedNodes).length, 2);
    assert.ok(result.debugInfo.selectedNodes['fi:standard']);
    assert.ok(result.debugInfo.selectedNodes['fi:game']);
    assert.equal(outputRemarks.includes('Finland Standard'), true);
    assert.equal(outputRemarks.includes('Finland Game'), true);
    assert.equal(outputRemarks.length, 2);
    assert.equal(repository.assignments.size, 2);
});

test('database balancer preserves original links when no active node exists', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('DE-STD-02'), buildVlessLink('FR-STD-01')].join('\n');

    repository.setStatus('DE-STD-02', 'dead');
    repository.setStatus('FR-STD-01', 'draining');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-no-active',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.body, body);
    assert.deepEqual(result.debugInfo.selectedNodes, {});
    assert.deepEqual(result.debugInfo.warnings, [
        'No active TopoR balancer node for de_standard:standard; preserving original links.',
        'No active TopoR balancer node for fr_standard:standard; preserving original links.',
    ]);
    assert.equal(repository.assignments.size, 0);
});

test('database balancer keeps an existing active assignment', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.assign('db-user-existing', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-existing',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNode, 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNodeStatus, 'active');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, false);
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentResult, 'kept');
});

test('database balancer keeps a draining assignment for existing users', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setStatus('FI-STD-02', 'draining');
    repository.assign('db-user-draining', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-draining',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNode, 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNodeStatus, 'draining');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, false);
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentResult, 'kept');
});

test('database balancer reassigns disabled assigned nodes to an active candidate', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setStatus('FI-STD-02', 'disabled');
    repository.assign('db-user-disabled', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-disabled',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-01');
    assert.equal(parseSubscription(result.body).links.length, 1);
    assert.equal(parseSubscription(result.body).links[0].remark, '\u{1F1EB}\u{1F1EE} Finland');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNode, 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNodeStatus, 'disabled');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, true);
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentResult, 'reassigned');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.selectedTechnicalHostName, 'FI-STD-01');
});

test('database balancer reassigns dead assigned nodes to an active candidate', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setStatus('FI-STD-02', 'dead');
    repository.assign('db-user-dead', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-dead',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-01');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNode, 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNodeStatus, 'dead');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, true);
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentResult, 'reassigned');
});

test('database balancer fails open clearly when disabled or dead assignment has no active candidates', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'disabled' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'dead' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.assign('db-user-no-active-disabled', 'fi_standard', 'standard', 'FI-STD-01');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-no-active-disabled',
        body,
        config,
        repository,
    });

    assert.equal(result.body, body);
    assert.deepEqual(result.debugInfo.selectedNodes, {});
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNode, 'FI-STD-01');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.previousAssignedNodeStatus, 'disabled');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, true);
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentResult, 'failed');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.failOpenReason, 'node_disabled');
    assert.ok(
        result.debugInfo.groupCandidateDiagnostics?.[0]?.excludedNodes.some(
            (node) => node.reason === 'node_dead',
        ),
    );
});

test('database balancer selects the lowest weighted load node', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setCapacity('FI-STD-01', 1, 300);
    repository.setCapacity('FI-STD-02', 2, 300);
    repository.assign('existing-1', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('existing-2', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'db-user-weighted',
        body,
        config: balancerConfig,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
});

test('least_loaded distributes according to effective load', async () => {
    const config = buildStrategyConfig('least_loaded');
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setCapacity('FI-STD-01', 1, 100);
    repository.setCapacity('FI-STD-02', 1, 300);
    repository.assign('least-existing-1', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('least-existing-2', 'fi_standard', 'standard', 'FI-STD-02');
    repository.assign('least-existing-3', 'fi_standard', 'standard', 'FI-STD-02');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'least-new',
        body,
        config,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
});

test('weighted strategy respects weights over repeated assignments', async () => {
    const config = buildStrategyConfig('weighted', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-02', weight: 3, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    for (let index = 0; index < 8; index += 1) {
        await processSubscriptionWithDatabaseBalancer({
            shortUuid: `weighted-user-${index}`,
            body,
            config,
            repository,
        });
    }

    const assignments = await repository.listAssignments({});
    const assignedToFirst = assignments.filter(
        (assignment) => assignment.technicalHostName === 'FI-STD-01',
    ).length;
    const assignedToSecond = assignments.filter(
        (assignment) => assignment.technicalHostName === 'FI-STD-02',
    ).length;

    assert.ok(assignedToSecond > assignedToFirst);
});

test('sticky_hash strategy is stable for same user and same node list', async () => {
    const config = buildStrategyConfig('sticky_hash');
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const firstResult = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'sticky-db-user',
        body,
        config,
        repository,
    });
    const secondResult = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'sticky-db-user',
        body,
        config,
        repository,
    });

    assert.deepEqual(firstResult.debugInfo.selectedNodes, secondResult.debugInfo.selectedNodes);
    assert.equal(repository.assignments.size, 0);
});

test('priority_failover strategy selects primary active node', async () => {
    const config = buildStrategyConfig('priority_failover', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active', priority: 20 },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'active', priority: 10 },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'priority-user',
        body,
        config,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
});

test('draining nodes do not receive new assignments', async () => {
    const config = buildStrategyConfig('least_loaded');
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    repository.setStatus('FI-STD-02', 'draining');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'draining-new-user',
        body,
        config,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-01');
});

test('disabled and dead nodes are excluded from new assignments', async () => {
    const config = buildStrategyConfig('least_loaded');
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [
        buildVlessLink('FI-STD-01'),
        buildVlessLink('FI-STD-02'),
        buildVlessLink('FI-STD-03'),
    ].join('\n');

    repository.setStatus('FI-STD-01', 'disabled');
    repository.setStatus('FI-STD-02', 'dead');

    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'exclude-new-user',
        body,
        config,
        repository,
    });

    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-03');
});

test('database balancer rewrites group when one node is disabled and another is active', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'disabled' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'one-disabled-one-active',
        body,
        config,
        repository,
    });
    const outputRemarks = parseSubscription(result.body).links.map((link) => link.remark);

    assert.deepEqual(outputRemarks, ['\u{1F1EB}\u{1F1EE} Finland']);
    assert.equal(result.debugInfo.selectedNodes['fi_standard:standard'], 'FI-STD-02');
    assert.equal(result.debugInfo.groupCandidateDiagnostics?.[0]?.reassignmentAttempted, false);
    assert.ok(
        result.debugInfo.groupCandidateDiagnostics?.[0]?.excludedNodes.some(
            (node) => node.technicalHostName === 'FI-STD-01' && node.reason === 'node_disabled',
        ),
    );
});

test('manual strategy fails open when no existing assignment exists', async () => {
    const config = buildStrategyConfig('manual');
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const result = await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'manual-new-user',
        body,
        config,
        repository,
    });

    assert.equal(result.body, body);
    assert.deepEqual(result.debugInfo.selectedNodes, {});
    assert.equal(repository.assignments.size, 0);
});

test('database balancer avoids duplicate assignment on concurrent duplicate request', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const body = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');

    const [firstResult, secondResult] = await Promise.all([
        processSubscriptionWithDatabaseBalancer({
            shortUuid: 'db-user-concurrent',
            body,
            config: balancerConfig,
            repository,
        }),
        processSubscriptionWithDatabaseBalancer({
            shortUuid: 'db-user-concurrent',
            body,
            config: balancerConfig,
            repository,
        }),
    ]);

    assert.deepEqual(firstResult.debugInfo.selectedNodes, secondResult.debugInfo.selectedNodes);
    assert.equal(repository.assignments.size, 1);
});

test('admin guard disables routes when token is not configured', () => {
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ADMIN_TOKEN: '',
        }),
    );
    const guard = new ToporBalancerAdminGuard(service);

    assert.throws(
        () => guard.canActivate(createExecutionContextStub('Bearer secret')),
        /Not Found/,
    );
});

test('admin guard requires a matching bearer token', () => {
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ADMIN_TOKEN: 'secret',
        }),
    );
    const guard = new ToporBalancerAdminGuard(service);

    assert.throws(
        () => guard.canActivate(createExecutionContextStub('Bearer wrong')),
        /Unauthorized/,
    );
    assert.equal(guard.canActivate(createExecutionContextStub('Bearer secret')), true);
});

test('ToporBalancerDiscoveryService has concrete Nest DI metadata', () => {
    const dependencies = Reflect.getMetadata(
        'design:paramtypes',
        ToporBalancerDiscoveryService,
    ) as unknown[];

    assert.equal(dependencies[0], AxiosService);
    assert.notEqual(dependencies[0], Function);
    assert.equal(dependencies[1], ConfigService);
    assert.equal(dependencies[2], ToporBalancerService);
});

test('static asset middleware allows public frontend assets without session cookie', () => {
    let nextCalled = false;
    let socketDestroyed = false;

    checkAssetsCookieMiddleware(
        {
            cookies: {},
            path: '/assets/index.js',
        } as never,
        {
            socket: {
                destroy: () => {
                    socketDestroyed = true;
                },
            },
        } as never,
        () => {
            nextCalled = true;
        },
    );

    assert.equal(nextCalled, true);
    assert.equal(socketDestroyed, false);
});

test('static asset middleware does not destroy non-asset requests with no session cookie', () => {
    let nextCalled = false;
    let socketDestroyed = false;

    checkAssetsCookieMiddleware(
        {
            cookies: {},
            path: '/admin/topor-balancer',
        } as never,
        {
            socket: {
                destroy: () => {
                    socketDestroyed = true;
                },
            },
        } as never,
        () => {
            nextCalled = true;
        },
    );

    assert.equal(nextCalled, true);
    assert.equal(socketDestroyed, false);
});

test('runtime config fallback serializes with missing session user', () => {
    const runtimeConfigService = new RuntimeConfigService({
        getSubscriptionPageConfigByEncryptedUuid: () => {
            throw new Error('should not be called');
        },
    } as never);

    const config = runtimeConfigService.getRuntimeConfig(undefined, {
        path: '/assets/.app-config-v2.json',
    } as never);
    const serializedConfig = runtimeConfigService.serializeRuntimeConfig(config);
    const parsedConfig = JSON.parse(serializedConfig);
    const health = runtimeConfigService.getHealth();

    assert.equal(parsedConfig.version, '1');
    assert.equal(health.lastConfigSource, 'fallback');
    assert.deepEqual(health.lastMissingSources, ['session.su']);
});

test('runtime config fallback handles malformed encrypted subpage UUID', () => {
    const runtimeConfigService = new RuntimeConfigService({
        getSubscriptionPageConfigByEncryptedUuid: () => null,
    } as never);

    const config = runtimeConfigService.getRuntimeConfig(
        {
            sessionId: 'unit-test',
            su: 'malformed',
        },
        {
            path: '/assets/.app-config-v2.json',
        } as never,
    );
    const serializedConfig = runtimeConfigService.serializeRuntimeConfig(config);
    const parsedConfig = JSON.parse(serializedConfig);
    const health = runtimeConfigService.getHealth();

    assert.equal(parsedConfig.version, '1');
    assert.equal(health.lastConfigSource, 'fallback');
    assert.equal(health.lastRuntimeConfigError?.includes('Subpage config'), true);
});

test('subscription discovery parses plain and base64 VLESS subscriptions without raw secrets', async () => {
    const plainBody = [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n');
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerDiscoveryService(
        {
            getSubscription: async () => ({
                headers: {
                    'content-type': 'text/plain',
                },
                response: plainBody,
            }),
        } as never,
        createConfigServiceStub({
            REMNAWAVE_PANEL_URL: 'https://panel.example.com',
        }) as never,
        {
            listAdminNodes: () => repository.listNodes(),
        } as never,
    );

    const response = await service.discoverFromSubscription('short-uuid');

    assert.equal(response.source, 'subscription');
    assert.equal(response.items.length, 2);
    assert.equal(response.items[0].technicalHostName, 'FI-STD-01');
    assert.equal(response.items[0].protocol, 'vless');
    assert.equal(response.items[0].pbk?.includes('publicKeyValue'), false);

    const base64Service = new ToporBalancerDiscoveryService(
        {
            getSubscription: async () => ({
                headers: {
                    'content-type': 'text/plain',
                },
                response: Buffer.from(plainBody, 'utf8').toString('base64'),
            }),
        } as never,
        createConfigServiceStub({
            REMNAWAVE_PANEL_URL: 'https://panel.example.com',
        }) as never,
        {
            listAdminNodes: () => repository.listNodes(),
        } as never,
    );

    const base64Response = await base64Service.discoverFromSubscription('short-uuid');

    assert.equal(base64Response.items.length, 2);
});

test('subscription discovery normalizes technicalHostName before matching imported nodes', async () => {
    const plainBody = [
        replaceVlessRemark(buildVlessLink('FI-STD-01'), ' FI-STD-01 '),
    ].join('\n');
    const repository = new InMemoryToporBalancerRepository();
    await repository.createNode({
        technicalHostName: 'FI-STD-01',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        planCode: 'standard',
        weight: 1,
        maxUsers: 300,
        status: 'active',
    });
    const service = new ToporBalancerDiscoveryService(
        {
            getSubscription: async () => ({
                headers: {
                    'content-type': 'text/plain',
                },
                response: plainBody,
            }),
        } as never,
        createConfigServiceStub({
            REMNAWAVE_PANEL_URL: 'https://panel.example.com',
        }) as never,
        {
            listAdminNodes: () => repository.listNodes(),
        } as never,
    );

    const response = await service.discoverFromSubscription('short-uuid');

    assert.equal(response.items.length, 1);
    assert.equal(response.items[0].technicalHostName, 'FI-STD-01');
    assert.equal(response.items[0].rawRemark, ' FI-STD-01 ');
    assert.equal(response.items[0].alreadyImported, true);
    assert.equal(response.items[0].matchedNodeId, 'FI-STD-01');
});

test('discovery import into existing group creates selected nodes', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'least_loaded',
    });

    const result = await service.importDiscoveredNodes({
        groupId: group.id,
        nodes: [
            {
                technicalHostName: 'FI-STD-01',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            },
        ],
    });
    const nodes = await repository.listNodes();

    assert.equal(result.created.length, 1);
    assert.equal(result.created[0].groupId, group.id);
    assert.equal(nodes.length, 1);
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.errors, []);
});

test('discovery import creates a new group from group payload', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const result = await service.importDiscoveredNodes({
        group: {
            locationCode: 'FI',
            planCode: 'standard',
            publicHostCode: 'fi_standard',
            publicName: 'Finland',
        },
        nodes: [
            {
                technicalHostName: 'FI-STD-01',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            },
        ],
    });
    const groups = await service.listAdminGroups();
    const nodes = await repository.listNodes();

    assert.equal(groups.length, 1);
    assert.equal(groups[0].publicHostCode, 'fi_standard');
    assert.equal(result.created.length, 1);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].groupId, groups[0].id);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.errors, []);
});

test('discovery import trims technicalHostName and imports multiple nodes idempotently', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const firstResult = await service.importDiscoveredNodes({
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        locationCode: 'FI',
        planCode: 'standard',
        nodes: [
            {
                technicalHostName: ' FI-STD-01 ',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            },
            {
                technicalHostName: 'FI-STD-02',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            },
        ],
    });
    const secondResult = await service.importDiscoveredNodes({
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        locationCode: 'FI',
        planCode: 'standard',
        nodes: [
            {
                technicalHostName: 'FI-STD-01',
                weight: 2,
                maxUsers: 500,
                status: 'active',
            },
            {
                technicalHostName: 'FI-STD-02',
                weight: 2,
                maxUsers: 500,
                status: 'active',
            },
        ],
    });
    const nodes = await repository.listNodes();

    assert.equal(firstResult.created.length, 2);
    assert.equal(secondResult.created.length, 0);
    assert.equal(secondResult.updated.length, 0);
    assert.equal(secondResult.skipped.length, 2);
    assert.equal(nodes.length, 2);
    assert.deepEqual(
        nodes.map((node) => node.technicalHostName).sort(),
        ['FI-STD-01', 'FI-STD-02'],
    );
});

test('discovery import reports cross-group technicalHostName conflicts', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const targetGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'premium',
        publicHostCode: 'fi_premium',
        publicName: 'Finland Premium',
        strategy: 'least_loaded',
    });
    const result = await service.importDiscoveredNodes({
        groupId: targetGroup.id,
        nodes: [
            {
                technicalHostName: 'FI-STD-01',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            },
        ],
    });

    assert.equal(result.created.length, 0);
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].technicalHostName, 'FI-STD-01');
    assert.equal(result.conflicts[0].existingPublicHostCode, 'fi_standard');
    assert.equal(result.conflicts[0].existingPlanCode, 'standard');
});

test('discovery import rejects missing required group and node fields', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () =>
            service.importDiscoveredNodes({
                publicHostCode: '',
                publicName: 'Finland',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: 'FI-STD-01',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            }),
        /publicHostCode must be a non-empty string/,
    );
    await assert.rejects(
        () =>
            service.importDiscoveredNodes({
                publicHostCode: 'fi_standard',
                publicName: 'Finland',
                locationCode: 'FI',
                planCode: 'standard',
                nodes: [
                    {
                        technicalHostName: '   ',
                        weight: 1,
                        maxUsers: 300,
                        status: 'active',
                    },
                ],
            }),
        /technicalHostName must be a non-empty string/,
    );
});

test('admin service lists, updates, and manually reassigns nodes', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_ADMIN_TOKEN: 'secret',
        }),
    );

    setServiceRepository(service, repository);

    const health = await service.getAdminHealth();
    const updatedNode = await service.updateAdminNode('FI-STD-01', {
        status: 'draining',
        weight: 2,
        maxUsers: 100,
        publicName: 'Finland public',
    });
    const reassignment = await service.reassignAdminAssignment({
        shortUuid: 'admin-user',
        publicHostCode: 'fi_standard',
        planCode: 'standard',
        technicalHostName: 'FI-STD-02',
    });
    const assignments = await service.listAdminAssignments({ shortUuid: 'admin-user' });
    const nodes = await service.listAdminNodes();

    assert.equal(health.databaseConnected, true);
    assert.equal(updatedNode.status, 'draining');
    assert.equal(updatedNode.weight, 2);
    assert.equal(updatedNode.maxUsers, 100);
    assert.equal(updatedNode.publicName, 'Finland public');
    assert.equal(reassignment.technicalHostName, 'FI-STD-02');
    assert.equal(assignments.length, 1);
    assert.ok(nodes.some((node) => node.technicalHostName === 'FI-STD-01'));
});

test('admin service resets assignments for a group', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    repository.assign('reset-1', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('reset-2', 'fi_standard', 'standard', 'FI-STD-02');
    repository.assign('keep-1', 'fi_game', 'game', 'FI-GAME-01');

    const summary = await service.resetGroupAssignments('fi_standard:standard', true);

    assert.deepEqual(summary, { removed: 2, reassigned: 0, skipped: 0, errors: [] });
    assert.equal((await repository.listGroupAssignments({ publicHostCode: 'fi_standard', planCode: 'standard' })).length, 0);
    assert.equal((await repository.listGroupAssignments({ publicHostCode: 'fi_game', planCode: 'game' })).length, 1);
});

test('admin service migrates assignments from a disabled node to active nodes', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    repository.setStatus('FI-STD-02', 'disabled');
    repository.assign('migrate-1', 'fi_standard', 'standard', 'FI-STD-02');
    repository.assign('migrate-2', 'fi_standard', 'standard', 'FI-STD-02');

    const summary = await service.migrateNodeAssignments('fi_standard:standard', 'FI-STD-02', true);
    const assignments = await repository.listGroupAssignments({
        publicHostCode: 'fi_standard',
        planCode: 'standard',
    });

    assert.equal(summary.reassigned, 2);
    assert.equal(summary.skipped, 0);
    assert.equal(assignments.every((assignment) => assignment.technicalHostName !== 'FI-STD-02'), true);
    assert.equal(
        assignments.every((assignment) =>
            ['FI-STD-01', 'FI-STD-03'].includes(assignment.technicalHostName ?? ''),
        ),
        true,
    );
});

test('admin service rebalances least_loaded assignments across active nodes', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'active' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    repository.assign('rebalance-1', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('rebalance-2', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('rebalance-3', 'fi_standard', 'standard', 'FI-STD-01');
    repository.assign('rebalance-4', 'fi_standard', 'standard', 'FI-STD-01');

    const summary = await service.rebalanceGroupAssignments('fi_standard:standard', true);
    const assignments = await repository.listGroupAssignments({
        publicHostCode: 'fi_standard',
        planCode: 'standard',
    });
    const firstCount = assignments.filter((assignment) => assignment.technicalHostName === 'FI-STD-01').length;
    const secondCount = assignments.filter((assignment) => assignment.technicalHostName === 'FI-STD-02').length;

    assert.equal(summary.reassigned, 4);
    assert.deepEqual([firstCount, secondCount].sort(), [2, 2]);
});

test('admin assignment actions never use disabled or dead nodes', async () => {
    const config = buildStrategyConfig('least_loaded', [
        { technicalHostName: 'FI-STD-01', weight: 1, maxUsers: 300, status: 'active' },
        { technicalHostName: 'FI-STD-02', weight: 1, maxUsers: 300, status: 'disabled' },
        { technicalHostName: 'FI-STD-03', weight: 1, maxUsers: 300, status: 'dead' },
    ]);
    const repository = InMemoryToporBalancerRepository.fromConfig(config);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    repository.assign('safe-1', 'fi_standard', 'standard', 'FI-STD-02');
    repository.assign('safe-2', 'fi_standard', 'standard', 'FI-STD-03');

    const summary = await service.rebalanceGroupAssignments('fi_standard:standard', true);
    const assignments = await repository.listGroupAssignments({
        publicHostCode: 'fi_standard',
        planCode: 'standard',
    });

    assert.equal(summary.reassigned, 2);
    assert.equal(assignments.every((assignment) => assignment.technicalHostName === 'FI-STD-01'), true);
});

test('admin service exposes recent diagnostics for a group', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    await processSubscriptionWithDatabaseBalancer({
        shortUuid: 'recent-diagnostics-user',
        body: [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n'),
        config: balancerConfig,
        repository,
        userAgent: 'v2raytun/windows',
    });

    const diagnostics = await service.listGroupRecentDiagnostics('fi_standard:standard');

    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].userAgent, 'v2raytun/windows');
    assert.equal(diagnostics[0].totalLinks, 2);
    assert.equal(diagnostics[0].matchedLinks, 2);
    assert.equal(diagnostics[0].status, 'processed');
    assert.ok(diagnostics[0].selectedNode);
});

test('database mode starts without a JSON config and exposes an empty nodes list', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_CONFIG_PATH: '/missing/topor-balancer.config.json',
            TOPOR_BALANCER_ADMIN_TOKEN: 'secret',
            TOPOR_BALANCER_IMPORT_CONFIG_ON_START: false,
        }),
    );

    setServiceRepository(service, repository);

    await service.onModuleInit();

    const health = await service.getAdminHealth();
    const nodes = await service.listAdminNodes();

    assert.equal(health.databaseConnected, true);
    assert.equal(health.configLoaded, false);
    assert.equal(nodes.length, 0);
});

test('database runtime processing uses current DB group settings after UI updates', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_ENABLED: true,
            TOPOR_BALANCER_ASSIGNMENT_MODE: 'database',
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
            TOPOR_BALANCER_DEBUG: false,
        }),
    );

    setServiceRepository(service, repository);

    await service.updateAdminGroup(groupKey('fi_standard', 'standard'), {
        publicName: 'Fresh DB Finland',
    });

    const result = await service.processWithDebug({
        shortUuid: 'fresh-db-user',
        body: [buildVlessLink('FI-STD-01'), buildVlessLink('FI-STD-02')].join('\n'),
        contentType: 'text/plain',
        requestPath: '/fresh-db-user',
        userAgent: 'UnitTest/1.0',
    });
    const outputRemarks = parseSubscription(result?.body ?? '').links.map((link) => link.remark);

    assert.deepEqual(outputRemarks, ['Fresh DB Finland']);
});

test('admin service creates nodes from UI payloads', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const node = await service.createAdminNode({
        technicalHostName: 'FI-STD-01',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        locationCode: 'FI',
        planCode: 'standard',
        weight: 1,
        maxUsers: 300,
        status: 'active',
    });

    assert.equal(node.technicalHostName, 'FI-STD-01');
    assert.equal(node.publicHostCode, 'fi_standard');
    assert.equal((await service.listAdminNodes()).length, 1);
});

test('admin service exposes migrated node rows as balancer groups', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const groups = await service.listAdminGroups();
    const fiGroup = groups.find((group) => group.publicHostCode === 'fi_standard');

    assert.ok(fiGroup);
    assert.equal(fiGroup.planCode, 'standard');
    assert.equal(fiGroup.nodesCount, 3);
    assert.equal(fiGroup.activeNodesCount, 3);
});

test('admin service rejects duplicate balancer group creation', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () =>
            service.createAdminGroup({
                enabled: true,
                locationCode: 'FI',
                planCode: 'standard',
                publicHostCode: 'fi_standard',
                publicName: 'Finland',
                strategy: 'least_loaded',
            }),
        /publicHostCode and planCode already exists/,
    );
});

test('admin service creates technical nodes inside a group', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'least_loaded',
    });
    const node = await service.createAdminGroupNode(group.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-STD-01',
        weight: 1,
    });

    assert.equal(node.groupId, group.id);
    assert.equal(node.publicHostCode, 'fi_standard');
    assert.equal(node.publicName, 'Finland');
    assert.equal(node.locationCode, 'FI');
    assert.equal(node.planCode, 'standard');
});

test('admin group counters match group node rows by group relation', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'least_loaded',
    });

    await service.createAdminGroupNode(group.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-STD-01',
        weight: 1,
    });

    let listedGroup = (await service.listAdminGroups()).find((item) => item.id === group.id);
    let groupNodes = await service.listAdminGroupNodes(group.id);

    assert.ok(listedGroup);
    assert.ok(groupNodes);
    assert.equal(listedGroup.nodesCount, 1);
    assert.equal(listedGroup.activeNodesCount, 1);
    assert.equal(listedGroup.nodesCountSource, 'db_group_id');
    assert.equal(groupNodes.length, 1);

    await service.createAdminGroupNode(group.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-STD-02',
        weight: 1,
    });

    listedGroup = (await service.listAdminGroups()).find((item) => item.id === group.id);
    groupNodes = await service.listAdminGroupNodes(group.id);

    assert.ok(listedGroup);
    assert.ok(groupNodes);
    assert.equal(listedGroup.nodesCount, 2);
    assert.equal(listedGroup.activeNodesCount, 2);
    assert.equal(groupNodes.length, 2);
});

test('admin service creates and fetches public groups with all supported strategies', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'weighted',
    });
    const fetchedGroup = await service.getAdminGroup(group.id);

    assert.equal(fetchedGroup.publicHostCode, 'fi_standard');
    assert.equal(fetchedGroup.locationCode, 'FI');
    assert.equal(fetchedGroup.strategy, 'weighted');

    for (const strategy of ['least_loaded', 'sticky_hash', 'priority_failover', 'manual'] as const) {
        const strategyGroup = await service.createAdminGroup({
            enabled: true,
            locationCode: 'FI',
            planCode: strategy,
            publicHostCode: `fi_${strategy}`,
            publicName: `Finland ${strategy}`,
            strategy,
        });

        assert.equal(strategyGroup.strategy, strategy);
    }
});

test('admin service rejects duplicate node only inside the same group', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const standardGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland Standard',
        strategy: 'least_loaded',
    });
    const premiumGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'premium',
        publicHostCode: 'fi_premium',
        publicName: 'Finland Premium',
        strategy: 'least_loaded',
    });

    await service.createAdminGroupNode(standardGroup.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-EDGE-01',
        weight: 1,
    });

    await assert.rejects(
        () =>
            service.createAdminGroupNode(standardGroup.id, {
                maxUsers: 300,
                status: 'active',
                technicalHostName: 'FI-EDGE-01',
                weight: 1,
            }),
        /group node already exists/,
    );

    const sameTechnicalNameInAnotherGroup = await service.createAdminGroupNode(premiumGroup.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-EDGE-01',
        weight: 1,
    });

    assert.equal(sameTechnicalNameInAnotherGroup.groupId, premiumGroup.id);
    assert.equal((await service.listAdminNodes()).length, 2);
});

test('admin service rejects deleting a group with nodes', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () => service.deleteAdminGroup('fi_standard:standard'),
        /group has nodes and cannot be deleted/,
    );
});

test('admin service rejects invalid node creation', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () =>
            service.createAdminNode({
                technicalHostName: '',
                publicHostCode: 'fi_standard',
                publicName: 'Finland',
                planCode: 'standard',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            }),
        /technicalHostName must be a non-empty string/,
    );
    await assert.rejects(
        () =>
            service.createAdminNode({
                technicalHostName: 'FI-STD-01',
                publicHostCode: 'fi_standard',
                publicName: 'Finland',
                locationCode: 'FI',
                planCode: 'standard',
                weight: 0,
                maxUsers: 300,
                status: 'active',
            }),
        /weight must be a finite number >= 1/,
    );
});

test('admin service rejects duplicate technicalHostName creation', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () =>
            service.createAdminNode({
                technicalHostName: 'FI-STD-01',
                publicHostCode: 'fi_standard',
                publicName: 'Finland',
                locationCode: 'FI',
                planCode: 'standard',
                weight: 1,
                maxUsers: 300,
                status: 'active',
            }),
        /technicalHostName already exists/,
    );
});

test('admin service rejects deleting a node with assignments', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);
    repository.assign('admin-user', 'fi_standard', 'standard', 'FI-STD-01');

    await assert.rejects(
        () => service.deleteAdminNode('FI-STD-01'),
        /has assignments and cannot be deleted/,
    );
});

test('admin service deletes a node without assignments', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const result = await service.deleteAdminNode('FR-STD-01');

    assert.equal(result.deleted, true);
    assert.equal(
        (await service.listAdminNodes()).some((node) => node.technicalHostName === 'FR-STD-01'),
        false,
    );
});

test('admin service rejects invalid node updates', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () => service.updateAdminNode('FI-STD-01', { weight: 0 }),
        /weight must be a finite number >= 1/,
    );
    await assert.rejects(
        () => service.updateAdminNode('FI-STD-01', { maxUsers: 0 }),
        /maxUsers must be an integer >= 1/,
    );
    await assert.rejects(
        () => service.updateAdminNode('FI-STD-01', { publicName: '   ' }),
        /publicName must be a non-empty string/,
    );
    await assert.rejects(
        () =>
            service.updateAdminNode('FI-STD-01', {
                status: 'broken' as ToporBalancerNodeStatus,
            }),
        /Invalid TopoR balancer node status/,
    );
});

test('admin service rejects unsafe manual reassignment', async () => {
    const repository = InMemoryToporBalancerRepository.fromConfig(balancerConfig);
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    await assert.rejects(
        () =>
            service.reassignAdminAssignment({
                shortUuid: '',
                publicHostCode: 'fi_standard',
                planCode: 'standard',
                technicalHostName: 'FI-STD-01',
            }),
        /shortUuid must be a non-empty string/,
    );
    await assert.rejects(
        () =>
            service.reassignAdminAssignment({
                shortUuid: 'admin-user',
                publicHostCode: 'de_standard',
                planCode: 'standard',
                technicalHostName: 'FI-STD-01',
            }),
        /does not match publicHostCode and planCode/,
    );

    repository.setStatus('FI-STD-01', 'draining');

    await assert.rejects(
        () =>
            service.reassignAdminAssignment({
                shortUuid: 'admin-user',
                publicHostCode: 'fi_standard',
                planCode: 'standard',
                technicalHostName: 'FI-STD-01',
            }),
        /reassignment target must be active/,
    );
});

test('group subscription discovery imports a free node into the selected group', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'least_loaded',
    });
    const discoveryService = new ToporBalancerDiscoveryService(
        {
            getSubscription: async () => ({
                headers: {
                    'content-type': 'text/plain',
                },
                response: buildVlessLink('FI-STD-09'),
            }),
        } as never,
        createConfigServiceStub({
            REMNAWAVE_PANEL_URL: 'https://panel.example.com',
        }) as never,
        service,
    );

    const beforeImport = await discoveryService.discoverGroupFromSubscription(group.id, 'short-uuid');

    assert.equal(beforeImport.group.id, group.id);
    assert.equal(beforeImport.items[0].technicalHostName, 'FI-STD-09');
    assert.equal(beforeImport.items[0].status, 'free');
    assert.equal(beforeImport.items[0].canAdd, true);
    assert.ok(!JSON.stringify(beforeImport).includes('44444444-4444-4444-8444-444444444444'));
    assert.ok(!JSON.stringify(beforeImport).includes('pbk=key'));

    const importResult = await service.importAdminGroupNodes(group.id, {
        defaults: {
            maxUsers: 300,
            status: 'active',
            technicalHostName: 'validation-placeholder',
            weight: 1,
        },
        mode: 'skip_conflicts',
        technicalHostNames: ['FI-STD-09'],
    });
    const afterImport = await discoveryService.discoverGroupFromSubscription(group.id, 'short-uuid');

    assert.equal(importResult.created.length, 1);
    assert.equal(afterImport.items[0].status, 'in_this_group');
    assert.equal(afterImport.items[0].currentGroupName, 'Finland');
    assert.equal(afterImport.items[0].canAdd, false);
});

test('group node import does not duplicate a node already in the selected group', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const group = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland',
        strategy: 'least_loaded',
    });

    await service.createAdminGroupNode(group.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-STD-01',
        weight: 1,
    });

    const importResult = await service.importAdminGroupNodes(group.id, {
        defaults: {
            maxUsers: 300,
            status: 'active',
            technicalHostName: 'validation-placeholder',
            weight: 1,
        },
        mode: 'skip_conflicts',
        technicalHostNames: ['FI-STD-01'],
    });

    assert.equal(importResult.created.length, 0);
    assert.equal(importResult.alreadyInGroup.length, 1);
    assert.equal((await service.listAdminGroupNodes(group.id)).length, 1);
});

test('group node import does not silently import a node from another group', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const standardGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland Standard',
        strategy: 'least_loaded',
    });
    const premiumGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'premium',
        publicHostCode: 'fi_premium',
        publicName: 'Finland Premium',
        strategy: 'least_loaded',
    });

    await service.createAdminGroupNode(premiumGroup.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-SHARED-01',
        weight: 1,
    });

    const importResult = await service.importAdminGroupNodes(standardGroup.id, {
        defaults: {
            maxUsers: 300,
            status: 'active',
            technicalHostName: 'validation-placeholder',
            weight: 1,
        },
        mode: 'skip_conflicts',
        technicalHostNames: ['FI-SHARED-01'],
    });

    assert.equal(importResult.created.length, 0);
    assert.equal(importResult.inOtherGroup.length, 1);
    assert.equal(importResult.inOtherGroup[0].currentGroupName, 'Finland Premium');
    assert.equal((await service.listAdminGroupNodes(standardGroup.id)).length, 0);
});

test('group import API returns a clear status summary', async () => {
    const repository = new InMemoryToporBalancerRepository();
    const service = new ToporBalancerService(
        createConfigServiceStub({
            TOPOR_BALANCER_DATABASE_URL: 'postgres://unit-test',
        }),
    );

    setServiceRepository(service, repository);

    const targetGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: 'Finland Standard',
        strategy: 'least_loaded',
    });
    const otherGroup = await service.createAdminGroup({
        enabled: true,
        locationCode: 'FI',
        planCode: 'premium',
        publicHostCode: 'fi_premium',
        publicName: 'Finland Premium',
        strategy: 'least_loaded',
    });

    await service.createAdminGroupNode(targetGroup.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-EXISTING-01',
        weight: 1,
    });
    await service.createAdminGroupNode(otherGroup.id, {
        maxUsers: 300,
        status: 'active',
        technicalHostName: 'FI-OTHER-01',
        weight: 1,
    });

    const importResult = await service.importAdminGroupNodes(targetGroup.id, {
        defaults: {
            maxUsers: 300,
            status: 'active',
            technicalHostName: 'validation-placeholder',
            weight: 1,
        },
        mode: 'skip_conflicts',
        technicalHostNames: ['FI-FREE-01', 'FI-EXISTING-01', 'FI-OTHER-01'],
    });

    assert.deepEqual(
        {
            alreadyInGroup: importResult.alreadyInGroup.length,
            created: importResult.created.length,
            errors: importResult.errors.length,
            inOtherGroup: importResult.inOtherGroup.length,
        },
        {
            alreadyInGroup: 1,
            created: 1,
            errors: 0,
            inOtherGroup: 1,
        },
    );
});

function createConfigServiceStub(values: Record<string, unknown>): ConfigService {
    return {
        get: (key: string) => values[key],
        getOrThrow: (key: string) => values[key],
    } as ConfigService;
}

function createExecutionContextStub(authorization?: string): ExecutionContext {
    return {
        switchToHttp: () => ({
            getRequest: () => ({
                headers: {
                    authorization,
                },
            }),
        }),
    } as ExecutionContext;
}

function setServiceRepository(
    service: ToporBalancerService,
    repository: ToporBalancerAssignmentRepository,
): void {
    (service as unknown as { repository: ToporBalancerAssignmentRepository }).repository =
        repository;
}

class InMemoryToporBalancerRepository implements ToporBalancerAssignmentRepository {
    public readonly assignments = new Map<string, string>();
    public readonly requests: ToporBalancerRequestLogInput[] = [];
    private readonly groups = new Map<string, ToporBalancerAdminGroup>();
    private readonly nodes = new Map<string, ToporBalancerDbNode>();
    private topologyCache: ToporRemnawaveTopologySnapshot = {
        hosts: [],
        inbounds: [],
        nodes: [],
        squads: [],
        warnings: [],
    };

    public static fromConfig(config: ToporBalancerConfig): InMemoryToporBalancerRepository {
        const repository = new InMemoryToporBalancerRepository();

        for (const location of config.locations) {
            const groupId = groupKey(location.publicHostCode, location.planCode);
            repository.groups.set(groupId, {
                id: groupId,
                activeNodesCount: location.nodes.filter((node) => node.status === 'active').length,
                assignedUsers: 0,
                enabled: true,
                locationCode: location.locationCode,
                nodesCount: location.nodes.length,
                nodesCountSource: 'db_group_id',
                planCode: location.planCode,
                publicHostCode: location.publicHostCode,
                publicName: location.publicName,
                squadScope: 'any_visible_to_user',
                strategy: location.strategy ?? 'least_loaded',
            });

            for (const node of location.nodes) {
                const nodeId = repository.buildNodeId(groupId, node.technicalHostName);

                repository.nodes.set(nodeId, {
                    id: nodeId,
                    groupId,
                    technicalHostName: node.technicalHostName,
                    publicHostCode: location.publicHostCode,
                    publicName: location.publicName,
                    locationCode: location.locationCode,
                    planCode: location.planCode,
                    priority: node.priority ?? 100,
                    weight: node.weight,
                    maxUsers: node.maxUsers,
                    status: node.status,
                    createdAt: new Date(0).toISOString(),
                    updatedAt: new Date(0).toISOString(),
                });
            }
        }

        return repository;
    }

    public async initializeSchema(): Promise<void> {}

    public async upsertConfiguredNodes(): Promise<void> {}

    public async close(): Promise<void> {}

    public async recordRequest(input: ToporBalancerRequestLogInput): Promise<void> {
        this.requests.push(input);
    }

    public async healthCheck(): Promise<boolean> {
        return true;
    }

    public async countNodes(): Promise<number> {
        return this.nodes.size;
    }

    public async countAssignments(): Promise<number> {
        return this.assignments.size;
    }

    public async countRequests(): Promise<number> {
        return this.requests.length;
    }

    public async listGroups(): Promise<ToporBalancerAdminGroup[]> {
        return Array.from(this.groups.values()).map((group) => {
            const groupNodes = Array.from(this.nodes.values()).filter(
                (node) => node.groupId === group.id,
            );

            return {
                ...group,
                activeNodesCount: groupNodes.filter((node) => node.status === 'active').length,
                assignedUsers: groupNodes.reduce(
                    (total, node) => total + this.countAssignmentsForNode(node.id),
                    0,
                ),
                nodesCount: groupNodes.length,
                nodesCountSource: 'db_group_id',
            };
        });
    }

    public async getGroup(id: string): Promise<ToporBalancerAdminGroup | null> {
        return (await this.listGroups()).find((group) => group.id === id) ?? null;
    }

    public async createGroup(
        input: ToporBalancerGroupCreateInput,
    ): Promise<ToporBalancerAdminGroup | null> {
        const id = groupKey(input.publicHostCode, input.planCode);

        if (this.groups.has(id)) {
            return null;
        }

        const group: ToporBalancerAdminGroup = {
            id,
            activeNodesCount: 0,
            assignedUsers: 0,
            enabled: input.enabled,
            locationCode: input.locationCode,
            nodesCount: 0,
            nodesCountSource: 'db_group_id',
            planCode: input.planCode,
            publicHostCode: input.publicHostCode,
            publicName: input.publicName,
            internalSquadUuid: input.internalSquadUuid,
            squadScope: input.squadScope ?? 'any_visible_to_user',
            strategy: input.strategy,
        };

        this.groups.set(id, group);

        return group;
    }

    public async updateGroup(
        id: string,
        input: ToporBalancerGroupUpdateInput,
    ): Promise<ToporBalancerAdminGroup | null> {
        const group = this.groups.get(id);

        if (!group) {
            return null;
        }

        Object.assign(group, {
            enabled: input.enabled ?? group.enabled,
            locationCode: input.locationCode ?? group.locationCode,
            planCode: input.planCode ?? group.planCode,
            publicHostCode: input.publicHostCode ?? group.publicHostCode,
            publicName: input.publicName ?? group.publicName,
            internalSquadUuid:
                input.internalSquadUuid === undefined
                    ? group.internalSquadUuid
                    : input.internalSquadUuid,
            squadScope: input.squadScope ?? group.squadScope,
            strategy: input.strategy ?? group.strategy,
        });

        for (const node of this.nodes.values()) {
            if (node.groupId === id) {
                node.locationCode = group.locationCode;
                node.planCode = group.planCode;
                node.publicHostCode = group.publicHostCode;
                node.publicName = group.publicName;
            }
        }

        return (await this.listGroups()).find((item) => item.id === id) ?? null;
    }

    public async deleteGroup(id: string): Promise<ToporBalancerGroupDeleteResult> {
        if (!this.groups.has(id)) {
            return 'not_found';
        }

        if (Array.from(this.nodes.values()).some((node) => node.groupId === id)) {
            return 'has_nodes';
        }

        this.groups.delete(id);

        return 'deleted';
    }

    public async listGroupNodes(groupId: string): Promise<ToporBalancerAdminNode[] | null> {
        if (!this.groups.has(groupId)) {
            return null;
        }

        return (await this.listNodes()).filter((node) => node.groupId === groupId);
    }

    public async createGroupNode(
        groupId: string,
        input: ToporBalancerGroupNodeCreateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const group = this.groups.get(groupId);

        if (!group) {
            return null;
        }

        if (
            Array.from(this.nodes.values()).some(
                (node) =>
                    node.groupId === groupId &&
                    node.technicalHostName === input.technicalHostName,
            )
        ) {
            return null;
        }

        const node: ToporBalancerDbNode = {
            id: this.buildNodeId(groupId, input.technicalHostName),
            groupId,
            locationCode: group.locationCode,
            maxUsers: input.maxUsers,
            planCode: group.planCode,
            publicHostCode: group.publicHostCode,
            publicName: group.publicName,
            priority: input.priority ?? 100,
            status: input.status,
            technicalHostName: input.technicalHostName,
            weight: input.weight,
        };

        this.nodes.set(node.id, node);

        return {
            ...node,
            assignedUsers: 0,
        };
    }

    public async updateGroupNode(
        groupId: string,
        nodeId: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const node = this.nodes.get(nodeId);

        if (!node || node.groupId !== groupId) {
            return null;
        }

        return this.updateNode(nodeId, input);
    }

    public async deleteGroupNode(
        groupId: string,
        nodeId: string,
    ): Promise<ToporBalancerNodeDeleteResult> {
        const node = this.nodes.get(nodeId);

        if (!node || node.groupId !== groupId) {
            return 'not_found';
        }

        return this.deleteNode(nodeId);
    }

    public async listNodes(): Promise<ToporBalancerAdminNode[]> {
        return Array.from(this.nodes.values()).map((node) => ({
            ...node,
            assignedUsers: this.countAssignmentsForNode(node.id),
        }));
    }

    public async createNode(
        input: ToporBalancerNodeCreateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const groupId = input.groupId ?? groupKey(input.publicHostCode, input.planCode);

        if (!this.groups.has(groupId)) {
            await this.createGroup({
                enabled: true,
                locationCode: input.locationCode,
                planCode: input.planCode,
                publicHostCode: input.publicHostCode,
                publicName: input.publicName,
                strategy: 'least_loaded',
            });
        }

        if (
            Array.from(this.nodes.values()).some(
                (node) =>
                    node.groupId === groupId &&
                    node.technicalHostName === input.technicalHostName,
            )
        ) {
            return null;
        }

        const node: ToporBalancerDbNode = {
            id: this.buildNodeId(groupId, input.technicalHostName),
            groupId,
            technicalHostName: input.technicalHostName,
            publicHostCode: input.publicHostCode,
            publicName: input.publicName,
            locationCode: input.locationCode,
            planCode: input.planCode,
            weight: input.weight,
            maxUsers: input.maxUsers,
            status: input.status,
            priority: input.priority ?? 100,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString(),
        };

        this.nodes.set(node.id, node);

        return {
            ...node,
            assignedUsers: 0,
        };
    }

    public async updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const node = this.nodes.get(id);

        if (!node) {
            return null;
        }

        if (input.technicalHostName !== undefined) {
            this.nodes.delete(id);
            node.id = input.technicalHostName;
            node.technicalHostName = input.technicalHostName;
            this.nodes.set(node.id, node);
        }

        if (input.publicHostCode !== undefined) {
            node.publicHostCode = input.publicHostCode;
        }

        if (input.locationCode !== undefined) {
            node.locationCode = input.locationCode;
        }

        if (input.planCode !== undefined) {
            node.planCode = input.planCode;
        }

        if (input.weight !== undefined) {
            node.weight = input.weight;
        }

        if (input.maxUsers !== undefined) {
            node.maxUsers = input.maxUsers;
        }

        if (input.status !== undefined) {
            node.status = input.status;
        }

        if (input.priority !== undefined) {
            node.priority = input.priority;
        }

        if (input.publicName !== undefined) {
            node.publicName = input.publicName;
        }

        return {
            ...node,
            assignedUsers: this.countAssignmentsForNode(node.id),
        };
    }

    public async upsertImportedNodes(
        input: ToporBalancerNodeCreateInput[],
    ): Promise<{ created: ToporBalancerAdminNode[]; updated: ToporBalancerAdminNode[] }> {
        const created: ToporBalancerAdminNode[] = [];
        const updated: ToporBalancerAdminNode[] = [];

        for (const node of input) {
            if (this.nodes.has(node.technicalHostName)) {
                const updatedNode = await this.updateNode(node.technicalHostName, {
                    locationCode: node.locationCode,
                    maxUsers: node.maxUsers,
                    planCode: node.planCode,
                    publicHostCode: node.publicHostCode,
                    publicName: node.publicName,
                    priority: node.priority,
                    status: node.status,
                    weight: node.weight,
                });

                if (updatedNode) {
                    updated.push(updatedNode);
                }
            } else {
                const createdNode = await this.createNode(node);

                if (createdNode) {
                    created.push(createdNode);
                }
            }
        }

        return { created, updated };
    }

    public async deleteNode(id: string): Promise<ToporBalancerNodeDeleteResult> {
        if (!this.nodes.has(id)) {
            return 'not_found';
        }

        if (this.countAssignmentsForNode(id) > 0) {
            return 'has_assignments';
        }

        this.nodes.delete(id);

        return 'deleted';
    }

    public async listAssignments(
        filters: ToporBalancerAssignmentFilters,
    ): Promise<ToporBalancerDbAssignment[]> {
        return Array.from(this.assignments.entries())
            .map(([key, nodeId]) => {
                const [shortUuid, publicHostCode, planCode] = key.split(':');
                const node = this.nodes.get(nodeId);

                return {
                    id: key,
                    shortUuid,
                    publicHostCode,
                    planCode,
                    nodeId: node?.id ?? nodeId,
                    technicalHostName: node?.technicalHostName ?? nodeId,
                };
            })
            .filter(
                (assignment) =>
                    (!filters.shortUuid || assignment.shortUuid === filters.shortUuid) &&
                    (!filters.publicHostCode ||
                        assignment.publicHostCode === filters.publicHostCode) &&
                    (!filters.planCode || assignment.planCode === filters.planCode) &&
                    (!filters.nodeId || assignment.nodeId === filters.nodeId),
            );
    }

    public async listGroupAssignments(filters: {
        publicHostCode: string;
        planCode: string;
    }): Promise<ToporBalancerDbAssignment[]> {
        return this.listAssignments({
            publicHostCode: filters.publicHostCode,
            planCode: filters.planCode,
        });
    }

    public async resetGroupAssignments(filters: {
        publicHostCode: string;
        planCode: string;
    }): Promise<number> {
        const assignments = await this.listGroupAssignments(filters);

        for (const assignment of assignments) {
            this.assignments.delete(
                assignmentKey(assignment.shortUuid, assignment.publicHostCode, assignment.planCode),
            );
        }

        return assignments.length;
    }

    public async reassign(
        input: ToporBalancerManualReassignInput,
    ): Promise<ToporBalancerDbAssignment | null> {
        const node = this.findNodeByTechnicalIdentity(
            input.publicHostCode,
            input.planCode,
            input.technicalHostName,
        );

        if (
            !node ||
            node.publicHostCode !== input.publicHostCode ||
            node.planCode !== input.planCode ||
            node.status !== 'active'
        ) {
            return null;
        }

        this.assign(input.shortUuid, input.publicHostCode, input.planCode, input.technicalHostName);

        return {
            id: assignmentKey(input.shortUuid, input.publicHostCode, input.planCode),
            shortUuid: input.shortUuid,
            publicHostCode: input.publicHostCode,
            planCode: input.planCode,
            nodeId: node.id,
            technicalHostName: node.technicalHostName,
        };
    }

    public async listRequests(
        filters: ToporBalancerRequestFilters,
    ): Promise<ToporBalancerAdminRequest[]> {
        return this.requests
            .map((request, index) => ({
                id: `${index}`,
                shortUuid: request.shortUuid,
                userAgent: request.userAgent,
                responseFormat: request.responseFormat,
                inputLinksCount: request.inputLinksCount,
                outputLinksCount: request.outputLinksCount,
                status: request.status,
                errorMessage: request.errorMessage,
                createdAt: new Date(0).toISOString(),
            }))
            .filter((request) => !filters.shortUuid || request.shortUuid === filters.shortUuid);
    }

    public async listGroupRecentDiagnostics(filters: {
        publicHostCode: string;
        planCode: string;
    }): Promise<ToporBalancerAdminRequest[]> {
        return this.requests
            .map((request, index) => ({
                id: `${index}`,
                shortUuid: request.shortUuid,
                userAgent: request.userAgent,
                responseFormat: request.responseFormat,
                inputLinksCount: request.inputLinksCount,
                matchedTechnicalLinks: request.matchedTechnicalLinks,
                outputLinksCount: request.outputLinksCount,
                rewrittenLinksCount: request.rewrittenLinksCount,
                selectedNodes: request.selectedNodes,
                status: request.status,
                errorMessage: request.errorMessage,
                groupCandidateDiagnostics:
                    request.groupCandidateDiagnostics as ToporBalancerAdminRequest['groupCandidateDiagnostics'],
                createdAt: new Date(0).toISOString(),
                warnings: request.warnings,
            }))
            .filter((request) =>
                request.groupCandidateDiagnostics?.some(
                    (group) =>
                        group.publicHostCode === filters.publicHostCode &&
                        group.planCode === filters.planCode,
                ),
            );
    }

    public async replaceRemnawaveTopologyCache(
        input: ToporRemnawaveTopologySnapshot,
    ): Promise<void> {
        this.topologyCache = input;
    }

    public async getRemnawaveTopologyCache(): Promise<ToporRemnawaveTopologySnapshot> {
        return this.topologyCache;
    }

    public async getOrCreateAssignment(
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const key = assignmentKey(
            input.shortUuid,
            input.location.publicHostCode,
            input.location.planCode,
        );
        const existingNodeId = this.assignments.get(key);
        const existingNode = existingNodeId ? this.nodes.get(existingNodeId) : undefined;

        if (
            existingNode &&
            input.candidateTechnicalHostNames.includes(existingNode.technicalHostName) &&
            (existingNode.status === 'active' || existingNode.status === 'draining')
        ) {
            return existingNode;
        }

        const activeCandidates = Array.from(this.nodes.values())
            .filter(
                (node) =>
                    node.publicHostCode === input.location.publicHostCode &&
                    node.planCode === input.location.planCode &&
                    node.status === 'active' &&
                    input.candidateTechnicalHostNames.includes(node.technicalHostName),
            );
        const selectedNode = this.selectActiveNode(input, activeCandidates);

        if (!selectedNode) {
            return null;
        }

        if ((input.location.strategy ?? 'least_loaded') !== 'sticky_hash') {
            this.assignments.set(key, selectedNode.id);
        }

        return selectedNode;
    }

    public assign(
        shortUuid: string,
        publicHostCode: string,
        planCode: string,
        technicalHostName: string,
    ): void {
        const node = this.findNodeByTechnicalIdentity(publicHostCode, planCode, technicalHostName);

        this.assignments.set(
            assignmentKey(shortUuid, publicHostCode, planCode),
            node?.id ?? technicalHostName,
        );
    }

    public setStatus(technicalHostName: string, status: ToporBalancerNodeStatus): void {
        const node = this.findNodeByTechnicalHostName(technicalHostName);

        if (node) {
            node.status = status;
        }
    }

    public setCapacity(technicalHostName: string, weight: number, maxUsers: number): void {
        const node = this.findNodeByTechnicalHostName(technicalHostName);

        if (node) {
            node.weight = weight;
            node.maxUsers = maxUsers;
        }
    }

    private countAssignmentsForNode(nodeId: string): number {
        return Array.from(this.assignments.values()).filter(
            (assignedNodeId) => assignedNodeId === nodeId,
        ).length;
    }

    private selectActiveNode(
        input: ToporBalancerAssignmentSelectionInput,
        candidates: ToporBalancerDbNode[],
    ): ToporBalancerDbNode | null {
        if (candidates.length === 0 || input.location.strategy === 'manual') {
            return null;
        }

        if (input.location.strategy === 'priority_failover') {
            return candidates
                .slice()
                .sort(
                    (left, right) =>
                        left.priority - right.priority ||
                        left.technicalHostName.localeCompare(right.technicalHostName),
                )[0];
        }

        if (input.location.strategy === 'sticky_hash') {
            const sorted = candidates
                .slice()
                .sort((left, right) =>
                    left.technicalHostName.localeCompare(right.technicalHostName),
                );
            const hash = createHash('sha256')
                .update(
                    `${input.shortUuid}:${input.location.publicHostCode}:${input.location.planCode}`,
                )
                .digest();

            return sorted[hash.readUInt32BE(0) % sorted.length];
        }

        if (input.location.strategy === 'weighted') {
            const underSoftLimit = candidates.filter(
                (node) => this.countAssignmentsForNode(node.id) < node.maxUsers,
            );
            const weightedCandidates = underSoftLimit.length > 0 ? underSoftLimit : candidates;

            return weightedCandidates
                .slice()
                .sort((left, right) => {
                    const leftScore = this.countAssignmentsForNode(left.id) / left.weight;
                    const rightScore = this.countAssignmentsForNode(right.id) / right.weight;

                    return (
                        leftScore - rightScore ||
                        left.technicalHostName.localeCompare(right.technicalHostName)
                    );
                })[0];
        }

        return candidates
            .slice()
            .sort((left, right) => {
                const leftLoad =
                    this.countAssignmentsForNode(left.id) / (left.maxUsers * left.weight);
                const rightLoad =
                    this.countAssignmentsForNode(right.id) / (right.maxUsers * right.weight);

                return (
                    leftLoad - rightLoad ||
                    left.technicalHostName.localeCompare(right.technicalHostName)
                );
            })[0];
    }

    private buildNodeId(groupId: string, technicalHostName: string): string {
        if (!this.nodes.has(technicalHostName)) {
            return technicalHostName;
        }

        return `${groupId}:${technicalHostName}`;
    }

    private findNodeByTechnicalHostName(technicalHostName: string): ToporBalancerDbNode | undefined {
        return Array.from(this.nodes.values()).find(
            (node) => node.technicalHostName === technicalHostName,
        );
    }

    private findNodeByTechnicalIdentity(
        publicHostCode: string,
        planCode: string,
        technicalHostName: string,
    ): ToporBalancerDbNode | undefined {
        return Array.from(this.nodes.values()).find(
            (node) =>
                node.publicHostCode === publicHostCode &&
                node.planCode === planCode &&
                node.technicalHostName === technicalHostName,
        );
    }
}

function assignmentKey(shortUuid: string, publicHostCode: string, planCode: string): string {
    return `${shortUuid}:${publicHostCode}:${planCode}`;
}

function groupKey(publicHostCode: string, planCode: string): string {
    return `${publicHostCode}:${planCode}`;
}
