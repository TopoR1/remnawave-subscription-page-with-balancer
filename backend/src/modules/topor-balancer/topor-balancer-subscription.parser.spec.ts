import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type {
    ToporBalancerAssignmentFilters,
    ToporBalancerAssignmentRepository,
    ToporBalancerAssignmentSelectionInput,
    ToporBalancerManualReassignInput,
    ToporBalancerNodeUpdateInput,
    ToporBalancerRequestLogInput,
    ToporBalancerRequestFilters,
} from './topor-balancer-database.repository';
import type {
    ToporBalancerAdminNode,
    ToporBalancerAdminRequest,
    ToporBalancerConfig,
    ToporBalancerDbAssignment,
    ToporBalancerDbNode,
    ToporBalancerNodeStatus,
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
import {
    ToporBalancerConfigValidationError,
    validateToporBalancerConfig,
} from './topor-balancer-config.validator';
import { processSubscriptionWithDatabaseBalancer } from './topor-balancer-database.processor';
import { processSubscriptionWithHashBalancer } from './topor-balancer-hash.processor';
import { parseToporBalancerConfig } from './topor-balancer-config.loader';
import { ToporBalancerAdminGuard } from './topor-balancer-admin.guard';
import { ToporBalancerService } from './topor-balancer.service';

const realityLink =
    'vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=reality&sni=www.microsoft.com&flow=xtls-rprx-vision&pbk=publicKeyValue&sid=abcd&fp=chrome#Finland';

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
});

test('database balancer reassigns disabled or dead assigned nodes', async () => {
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
        /weight must be a finite number > 0/,
    );
    await assert.rejects(
        () => service.updateAdminNode('FI-STD-01', { maxUsers: 0 }),
        /maxUsers must be an integer >= 1/,
    );
    await assert.rejects(
        () => service.updateAdminNode('FI-STD-01', { publicName: '   ' }),
        /publicName must be non-empty/,
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
    private readonly nodes = new Map<string, ToporBalancerDbNode>();

    public static fromConfig(config: ToporBalancerConfig): InMemoryToporBalancerRepository {
        const repository = new InMemoryToporBalancerRepository();

        for (const location of config.locations) {
            for (const node of location.nodes) {
                repository.nodes.set(node.technicalHostName, {
                    id: node.technicalHostName,
                    technicalHostName: node.technicalHostName,
                    publicHostCode: location.publicHostCode,
                    publicName: location.publicName,
                    locationCode: location.locationCode,
                    planCode: location.planCode,
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

    public async listNodes(): Promise<ToporBalancerAdminNode[]> {
        return Array.from(this.nodes.values()).map((node) => ({
            ...node,
            assignedUsers: this.countAssignmentsForNode(node.id),
        }));
    }

    public async updateNode(
        id: string,
        input: ToporBalancerNodeUpdateInput,
    ): Promise<ToporBalancerAdminNode | null> {
        const node = this.nodes.get(id);

        if (!node) {
            return null;
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

        if (input.publicName !== undefined) {
            node.publicName = input.publicName;
        }

        return {
            ...node,
            assignedUsers: this.countAssignmentsForNode(node.id),
        };
    }

    public async listAssignments(
        filters: ToporBalancerAssignmentFilters,
    ): Promise<ToporBalancerDbAssignment[]> {
        return Array.from(this.assignments.entries())
            .map(([key, technicalHostName]) => {
                const [shortUuid, publicHostCode, planCode] = key.split(':');
                const node = this.nodes.get(technicalHostName);

                return {
                    id: key,
                    shortUuid,
                    publicHostCode,
                    planCode,
                    nodeId: node?.id ?? technicalHostName,
                    technicalHostName,
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

    public async reassign(
        input: ToporBalancerManualReassignInput,
    ): Promise<ToporBalancerDbAssignment | null> {
        const node = this.nodes.get(input.technicalHostName);

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

    public async getOrCreateAssignment(
        input: ToporBalancerAssignmentSelectionInput,
    ): Promise<ToporBalancerDbNode | null> {
        const key = assignmentKey(
            input.shortUuid,
            input.location.publicHostCode,
            input.location.planCode,
        );
        const existingTechnicalHostName = this.assignments.get(key);
        const existingNode = existingTechnicalHostName
            ? this.nodes.get(existingTechnicalHostName)
            : undefined;

        if (
            existingNode &&
            input.candidateTechnicalHostNames.includes(existingNode.technicalHostName) &&
            (existingNode.status === 'active' || existingNode.status === 'draining')
        ) {
            return existingNode;
        }

        const selectedNode = Array.from(this.nodes.values())
            .filter(
                (node) =>
                    node.publicHostCode === input.location.publicHostCode &&
                    node.planCode === input.location.planCode &&
                    node.status === 'active' &&
                    input.candidateTechnicalHostNames.includes(node.technicalHostName),
            )
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

        if (!selectedNode) {
            return null;
        }

        this.assignments.set(key, selectedNode.technicalHostName);

        return selectedNode;
    }

    public assign(
        shortUuid: string,
        publicHostCode: string,
        planCode: string,
        technicalHostName: string,
    ): void {
        this.assignments.set(assignmentKey(shortUuid, publicHostCode, planCode), technicalHostName);
    }

    public setStatus(technicalHostName: string, status: ToporBalancerNodeStatus): void {
        const node = this.nodes.get(technicalHostName);

        if (node) {
            node.status = status;
        }
    }

    public setCapacity(technicalHostName: string, weight: number, maxUsers: number): void {
        const node = this.nodes.get(technicalHostName);

        if (node) {
            node.weight = weight;
            node.maxUsers = maxUsers;
        }
    }

    private countAssignmentsForNode(nodeId: string): number {
        return Array.from(this.assignments.values()).filter(
            (technicalHostName) => technicalHostName === nodeId,
        ).length;
    }
}

function assignmentKey(shortUuid: string, publicHostCode: string, planCode: string): string {
    return `${shortUuid}:${publicHostCode}:${planCode}`;
}
