import { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';

import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';

import { TRequestTemplateTypeKeys } from '@remnawave/backend-contract';

import { AxiosService } from '@common/axios/axios.service';
import { IGNORED_HEADERS } from '@common/constants';
import { sanitizeUsername } from '@common/utils';

import { ToporBalancerService } from '@modules/topor-balancer';
import {
    decodeSubscriptionBody,
    detectSubscriptionFormat,
    extractVlessLinks,
} from '@modules/topor-balancer/topor-balancer-subscription.parser';
import type { ToporBalancerProcessResult } from '@modules/topor-balancer/types';

import { SubpageConfigService } from './subpage-config.service';

@Injectable()
export class RootService {
    private readonly logger = new Logger(RootService.name);

    private readonly isMarzbanLegacyLinkEnabled: boolean;
    private readonly marzbanSecretKeys: string[];
    private readonly mlDropRevokedSubscriptions: boolean;
    private readonly isToporBalancerDebugEnabled: boolean;

    constructor(
        private readonly configService: ConfigService,
        private readonly jwtService: JwtService,
        private readonly axiosService: AxiosService,
        private readonly subpageConfigService: SubpageConfigService,
        private readonly toporBalancerService: ToporBalancerService,
    ) {
        this.isMarzbanLegacyLinkEnabled = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_LINK_ENABLED',
        );
        this.mlDropRevokedSubscriptions = this.configService.getOrThrow<boolean>(
            'MARZBAN_LEGACY_DROP_REVOKED_SUBSCRIPTIONS',
        );
        this.isToporBalancerDebugEnabled =
            this.configService.getOrThrow<boolean>('TOPOR_BALANCER_DEBUG');

        const marzbanSecretKeys = this.configService.get<string>('MARZBAN_LEGACY_SECRET_KEY');

        if (marzbanSecretKeys && marzbanSecretKeys.length > 0) {
            this.marzbanSecretKeys = marzbanSecretKeys.split(',').map((key) => key.trim());
        } else {
            this.marzbanSecretKeys = [];
        }
    }

    public async serveSubscriptionPage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
        clientType?: TRequestTemplateTypeKeys,
    ): Promise<void> {
        try {
            const userAgent = req.headers['user-agent'];

            let shortUuidLocal = shortUuid;

            if (this.isGenericPath(req.path)) {
                res.socket?.destroy();
                return;
            }

            if (this.isMarzbanLegacyLinkEnabled) {
                const username = await this.tryDecodeMarzbanLink(shortUuid);

                if (username) {
                    const sanitizedUsername = sanitizeUsername(username.username);

                    this.logger.log(
                        `Decoded Marzban username: ${username.username}, sanitized username: ${sanitizedUsername}`,
                    );

                    const userInfo = await this.axiosService.getUserByUsername(
                        clientIp,
                        sanitizedUsername,
                    );
                    if (!userInfo.isOk || !userInfo.response) {
                        this.logger.error(
                            `Decoded Marzban username is not found in Remnawave, decoded username: ${sanitizedUsername}`,
                        );

                        res.socket?.destroy();
                        return;
                    } else if (
                        this.mlDropRevokedSubscriptions &&
                        userInfo.response.response.subRevokedAt !== null
                    ) {
                        res.socket?.destroy();
                        return;
                    }

                    shortUuidLocal = userInfo.response.response.shortUuid;
                }
            }

            if (userAgent && this.isBrowser(userAgent)) {
                return this.returnWebpage(clientIp, req, res, shortUuidLocal);
            }

            const subscriptionDataResponse = await this.axiosService.getSubscriptionWithTrace(
                clientIp,
                shortUuidLocal,
                req.headers,
                !!clientType,
                clientType,
            );

            if (!subscriptionDataResponse) {
                res.socket?.destroy();
                return;
            }

            if (subscriptionDataResponse.headers) {
                Object.entries(subscriptionDataResponse.headers)
                    .filter(([key]) => !IGNORED_HEADERS.has(key.toLowerCase()))
                    .forEach(([key, value]) => {
                        res.setHeader(key, value);
                    });
            }

            const contentTypeHeader = res.getHeader('content-type');
            const contentType = Array.isArray(contentTypeHeader)
                ? contentTypeHeader.join(', ')
                : contentTypeHeader?.toString();
            const result = await this.toporBalancerService.processWithDebug({
                shortUuid: shortUuidLocal,
                body: subscriptionDataResponse.response,
                contentType,
                requestPath: req.path,
                userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
            });
            const finalResponse = result?.body ?? subscriptionDataResponse.response;

            this.toporBalancerService.recordSubscriptionTrace({
                id: `${Date.now()}-${shortUuidLocal.slice(0, 4)}`,
                request: this.buildRequestTrace({
                    clientIp,
                    flow: 'raw',
                    rawSubscriptionUsed: true,
                    req,
                    returnWebpageUsed: false,
                    shortUuid: shortUuidLocal,
                }),
                upstream: this.toporBalancerService.analyzeSubscriptionBody(
                    subscriptionDataResponse.trace.endpointType,
                    subscriptionDataResponse.response,
                    contentType,
                    subscriptionDataResponse.trace.outgoingUserAgent,
                ),
                balancer: this.toporBalancerService.buildBalancerTrace({
                    contentType,
                    inputBody: subscriptionDataResponse.response,
                    outputBody: finalResponse,
                    result,
                }),
            });

            this.logToporBalancerDebug(req, res, finalResponse, clientType);

            res.status(200).send(finalResponse);
            return;
        } catch (error) {
            this.logger.error('Error in serveSubscriptionPage', error);

            res.socket?.destroy();
            return;
        }
    }

    private generateJwtForCookie(uuid: string | null): string {
        return this.jwtService.sign(
            {
                sessionId: nanoid(32),
                su: this.subpageConfigService.getEncryptedSubpageConfigUuid(uuid),
            },
            {
                expiresIn: '33m',
            },
        );
    }

    private isBrowser(userAgent: string): boolean {
        const browserKeywords = [
            'Mozilla',
            'Chrome',
            'Safari',
            'Firefox',
            'Opera',
            'Edge',
            'TelegramBot',
            'WhatsApp',
        ];

        return browserKeywords.some((keyword) => userAgent.includes(keyword));
    }

    private isGenericPath(path: string): boolean {
        const genericPaths = [
            'favicon.ico',
            'robots.txt',
            '.png',
            '.jpg',
            '.jpeg',
            '.gif',
            '.svg',
            '.webp',
            '.ico',
        ];

        return genericPaths.some((genericPath) => path.includes(genericPath));
    }

    private async returnWebpage(
        clientIp: string,
        req: Request,
        res: Response,
        shortUuid: string,
    ): Promise<void> {
        try {
            const subscriptionDataResponse = await this.axiosService.getSubscriptionInfo(
                clientIp,
                shortUuid,
            );

            if (!subscriptionDataResponse.isOk || !subscriptionDataResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfigResponse = await this.axiosService.getSubpageConfig(
                shortUuid,
                req.headers,
            );

            if (!subpageConfigResponse.isOk || !subpageConfigResponse.response) {
                res.socket?.destroy();
                return;
            }

            const subpageConfig = subpageConfigResponse.response;

            if (subpageConfig.webpageAllowed === false) {
                this.logger.log(`Webpage access is not allowed by Remnawave's SRR.`);
                res.socket?.destroy();
                return;
            }

            const baseSettings = this.subpageConfigService.getBaseSettings(
                subpageConfig.subpageConfigUuid,
            );

            const subscriptionData = subscriptionDataResponse.response;

            if (baseSettings.showConnectionKeys) {
                await this.processBrowserPanelSubscriptionLinks(subscriptionData, shortUuid, req);
            } else {
                this.logToporBalancerBrowserDebug({
                    browserFlowProcessed: false,
                    inputLinksCount: 0,
                    outputLinksCount: 0,
                    matchedTechnicalLinks: 0,
                    selectedNodes: {},
                    rewrittenLinksCount: 0,
                    reason: 'showConnectionKeys=false',
                });
                subscriptionData.response.links = [];
                subscriptionData.response.ssConfLinks = {};
            }

            res.cookie('session', this.generateJwtForCookie(subpageConfig.subpageConfigUuid), {
                httpOnly: true,
                secure: true,
                maxAge: 1_800_000, // 30 minutes
            });

            const viewModel = {
                metaTitle: baseSettings.metaTitle,
                metaDescription: baseSettings.metaDescription,
                panelData: Buffer.from(JSON.stringify(subscriptionData)).toString('base64'),
            };

            this.toporBalancerService.recordSubscriptionTrace({
                id: `${Date.now()}-${shortUuid.slice(0, 4)}`,
                request: this.buildRequestTrace({
                    clientIp,
                    flow: 'browser',
                    rawSubscriptionUsed: false,
                    req,
                    returnWebpageUsed: true,
                    shortUuid,
                }),
                upstream: this.toporBalancerService.analyzeSubscriptionBody(
                    'getSubscriptionInfo',
                    subscriptionDataResponse.response,
                    'application/json',
                    undefined,
                ),
                balancer: this.toporBalancerService.buildBalancerTrace({
                    contentType: 'application/json',
                    inputBody: JSON.stringify(subscriptionDataResponse.response),
                    outputBody: JSON.stringify(subscriptionData),
                    result: null,
                }),
            });

            if (!this.isToporBalancerDebugEnabled) {
                res.render('index', viewModel);
                return;
            }

            res.render('index', viewModel, (error, html) => {
                if (error) {
                    this.logger.error(`Error in returnWebpage render: ${error}`);
                    res.socket?.destroy();
                    return;
                }

                res.type('html');
                this.logToporBalancerDebug(req, res, html, 'browser-html');
                res.send(html);
            });
        } catch (error) {
            this.logger.error(`Error in returnWebpage: ${error}`);

            res.socket?.destroy();
            return;
        }
    }

    private async processBrowserPanelSubscriptionLinks(
        subscriptionData: {
            response?: {
                links?: unknown;
            };
        },
        shortUuid: string,
        req: Request,
    ): Promise<void> {
        const links = subscriptionData.response?.links;
        const subscriptionResponse = subscriptionData.response;
        const browserDebug = {
            browserFlowProcessed: false,
            inputLinksCount: this.countPanelLinks(links),
            outputLinksCount: this.countPanelLinks(links),
            matchedTechnicalLinks: 0,
            selectedNodes: {} as Record<string, string>,
            rewrittenLinksCount: 0,
        };

        if (links === undefined || links === null) {
            this.logToporBalancerBrowserDebug(browserDebug);
            return;
        }

        if (!subscriptionResponse) {
            this.logToporBalancerBrowserDebug({
                ...browserDebug,
                reason: 'missing-subscription-response',
            });
            return;
        }

        try {
            if (Array.isArray(links)) {
                const stringLinks = links.filter((link): link is string => typeof link === 'string');
                const inputBody = stringLinks.join('\n');
                const result = await this.toporBalancerService.processWithDebug({
                    shortUuid,
                    body: inputBody,
                    contentType: 'text/plain',
                    requestPath: req.path,
                    userAgent: this.formatUserAgent(req.headers['user-agent']),
                });

                if (!result) {
                    this.logToporBalancerBrowserDebug(browserDebug);
                    return;
                }

                const outputLinks = result.body.split(/\r?\n/).filter((line) => line.trim());

                subscriptionResponse.links = outputLinks;
                this.logToporBalancerBrowserDebug(
                    this.buildBrowserPanelDebugInfo({
                        browserFlowProcessed: true,
                        inputBody,
                        outputBody: result.body,
                        result,
                    }),
                );
                return;
            }

            if (typeof links === 'string' || Buffer.isBuffer(links)) {
                const inputBody = Buffer.isBuffer(links) ? links.toString('utf8') : links;
                const result = await this.toporBalancerService.processWithDebug({
                    shortUuid,
                    body: links,
                    requestPath: req.path,
                    userAgent: this.formatUserAgent(req.headers['user-agent']),
                });

                if (!result) {
                    this.logToporBalancerBrowserDebug(browserDebug);
                    return;
                }

                subscriptionResponse.links = result.body;
                this.logToporBalancerBrowserDebug(
                    this.buildBrowserPanelDebugInfo({
                        browserFlowProcessed: true,
                        inputBody,
                        outputBody: result.body,
                        result,
                    }),
                );
                return;
            }

            this.logToporBalancerBrowserDebug({
                ...browserDebug,
                reason: 'unsupported-links-shape',
            });
        } catch (error) {
            this.logger.warn(`TopoR browser panel balancing failed open: ${error}`);
            this.logToporBalancerBrowserDebug({
                ...browserDebug,
                reason: 'balancer-failed-open',
            });
        }
    }

    private buildBrowserPanelDebugInfo(input: {
        browserFlowProcessed: boolean;
        inputBody: string;
        outputBody: string;
        result: ToporBalancerProcessResult;
    }): {
        browserFlowProcessed: boolean;
        inputLinksCount: number;
        outputLinksCount: number;
        matchedTechnicalLinks: number;
        selectedNodes: Record<string, string>;
        rewrittenLinksCount: number;
    } {
        return {
            browserFlowProcessed: input.browserFlowProcessed,
            inputLinksCount: this.countSubscriptionBodyVlessLinks(input.inputBody),
            outputLinksCount: this.countSubscriptionBodyVlessLinks(input.outputBody),
            matchedTechnicalLinks: input.result.debugInfo.matchedTechnicalLinks,
            selectedNodes: input.result.debugInfo.selectedNodes,
            rewrittenLinksCount: this.countRewrittenSubscriptionLinks(input.inputBody, input.outputBody),
        };
    }

    private countPanelLinks(links: unknown): number {
        if (Array.isArray(links)) {
            return links.filter((link) => typeof link === 'string' && link.startsWith('vless://')).length;
        }

        if (typeof links === 'string' || Buffer.isBuffer(links)) {
            return this.countSubscriptionBodyVlessLinks(
                Buffer.isBuffer(links) ? links.toString('utf8') : links,
            );
        }

        return 0;
    }

    private countSubscriptionBodyVlessLinks(body: string): number {
        const format = detectSubscriptionFormat(body);

        return extractVlessLinks(decodeSubscriptionBody(body, format)).length;
    }

    private countRewrittenSubscriptionLinks(inputBody: string, outputBody: string): number {
        const inputFormat = detectSubscriptionFormat(inputBody);
        const outputFormat = detectSubscriptionFormat(outputBody);
        const inputLinks = extractVlessLinks(decodeSubscriptionBody(inputBody, inputFormat));
        const outputLinksByStableKey = new Map(
            extractVlessLinks(decodeSubscriptionBody(outputBody, outputFormat)).map((link) => [
                [link.protocol, link.uuid, link.host, link.port ?? '', link.rawQuery].join('|'),
                link,
            ]),
        );

        return inputLinks.filter((link) => {
            const outputLink = outputLinksByStableKey.get(
                [link.protocol, link.uuid, link.host, link.port ?? '', link.rawQuery].join('|'),
            );

            return outputLink !== undefined && outputLink.remark !== link.remark;
        }).length;
    }

    private formatUserAgent(userAgent: string | string[] | undefined): string | undefined {
        return Array.isArray(userAgent) ? userAgent.join(', ') : userAgent;
    }

    private buildRequestTrace(input: {
        clientIp: string;
        flow: 'browser' | 'raw';
        rawSubscriptionUsed: boolean;
        req: Request;
        returnWebpageUsed: boolean;
        shortUuid: string;
    }) {
        return {
            timestamp: new Date().toISOString(),
            shortUuid: this.maskSecret(input.shortUuid),
            requestPath: input.req.path,
            queryString: input.req.url.includes('?') ? input.req.url.slice(input.req.url.indexOf('?') + 1) : '',
            method: input.req.method,
            host: this.formatUserAgent(input.req.headers.host),
            userAgent: this.formatUserAgent(input.req.headers['user-agent']),
            accept: this.formatUserAgent(input.req.headers.accept),
            acceptLanguage: this.formatUserAgent(input.req.headers['accept-language']),
            secFetchMode: this.formatUserAgent(input.req.headers['sec-fetch-mode']),
            xForwardedProto: this.formatUserAgent(input.req.headers['x-forwarded-proto']),
            xForwardedHost: this.formatUserAgent(input.req.headers['x-forwarded-host']),
            xRealIp: this.maskSecret(this.formatUserAgent(input.req.headers['x-real-ip']) ?? ''),
            clientIp: this.maskIp(input.clientIp),
            flow: input.flow,
            returnWebpageUsed: input.returnWebpageUsed,
            rawSubscriptionUsed: input.rawSubscriptionUsed,
        };
    }

    private maskSecret(value: string): string {
        if (value.length <= 8) {
            return value ? `${value.slice(0, 2)}***` : '';
        }

        return `${value.slice(0, 4)}...${value.slice(-4)}`;
    }

    private maskIp(value: string): string {
        if (value.includes(':')) {
            return `${value.split(':').slice(0, 2).join(':')}:***`;
        }

        const parts = value.split('.');
        return parts.length === 4 ? `${parts[0]}.${parts[1]}.x.x` : this.maskSecret(value);
    }

    private logToporBalancerBrowserDebug(debugInfo: Record<string, unknown>): void {
        if (!this.isToporBalancerDebugEnabled) {
            return;
        }

        this.logger.log(`[TOPOR_BALANCER_BROWSER_DEBUG] ${JSON.stringify(debugInfo)}`);
    }

    private async tryDecodeMarzbanLink(shortUuid: string): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (!this.marzbanSecretKeys.length) return null;

        const token = shortUuid;
        this.logger.debug(`Verifying token: ${token}`);

        if (!token || token.length < 10) {
            this.logger.debug(`Token too short: ${token}`);
            return null;
        }

        for (const key of this.marzbanSecretKeys) {
            const result = await this.decodeMarzbanLink(shortUuid, key);
            if (result) return result;

            this.logger.debug(`Decoding Marzban link failed with key: ${key}`);
        }

        this.logger.debug(`Decoding Marzban link failed with all keys`);

        return null;
    }

    private async decodeMarzbanLink(
        token: string,
        marzbanSecretKey: string,
    ): Promise<{
        username: string;
        createdAt: Date;
    } | null> {
        if (token.split('.').length === 3) {
            try {
                const payload = await this.jwtService.verifyAsync(token, {
                    secret: marzbanSecretKey,
                    algorithms: ['HS256'],
                });

                if (payload.access !== 'subscription') {
                    throw new Error('JWT access field is not subscription');
                }

                const jwtCreatedAt = new Date(payload.iat * 1000);

                if (!this.checkSubscriptionValidity(jwtCreatedAt, payload.sub)) {
                    return null;
                }

                this.logger.debug(`JWT verified successfully, ${JSON.stringify(payload)}`);

                return {
                    username: payload.sub,
                    createdAt: jwtCreatedAt,
                };
            } catch (err) {
                this.logger.debug(`JWT verification failed: ${err}`);
            }
        }

        const uToken = token.slice(0, token.length - 10);
        const uSignature = token.slice(token.length - 10);

        this.logger.debug(`Token parts: base: ${uToken}, signature: ${uSignature}`);

        let decoded: string;
        try {
            decoded = Buffer.from(uToken, 'base64url').toString();
        } catch (err) {
            this.logger.debug(`Base64 decode error: ${err}`);
            return null;
        }

        const hash = createHash('sha256');
        hash.update(uToken + marzbanSecretKey);
        const digest = hash.digest();

        const expectedSignature = Buffer.from(digest).toString('base64url').slice(0, 10);

        this.logger.debug(`Expected signature: ${expectedSignature}, actual: ${uSignature}`);

        if (uSignature !== expectedSignature) {
            this.logger.debug('Signature mismatch');
            return null;
        }

        const parts = decoded.split(',');
        if (parts.length < 2) {
            this.logger.debug(`Invalid token format: ${decoded}`);
            return null;
        }

        const username = parts[0];
        const createdAtInt = parseInt(parts[1], 10);

        if (isNaN(createdAtInt)) {
            this.logger.debug(`Invalid created_at timestamp: ${parts[1]}`);
            return null;
        }

        const createdAt = new Date(createdAtInt * 1000);

        if (!this.checkSubscriptionValidity(createdAt, username)) {
            return null;
        }

        this.logger.debug(`Token decoded. Username: ${username}, createdAt: ${createdAt}`);

        return {
            username,
            createdAt,
        };
    }

    private checkSubscriptionValidity(createdAt: Date, username: string): boolean {
        const validFrom = this.configService.get<string | undefined>(
            'MARZBAN_LEGACY_SUBSCRIPTION_VALID_FROM',
        );

        if (!validFrom) {
            return true;
        }

        const validFromDate = new Date(validFrom);
        if (createdAt < validFromDate) {
            this.logger.debug(
                `createdAt JWT: ${createdAt.toISOString()} is before validFrom: ${validFromDate.toISOString()}`,
            );

            this.logger.warn(
                `${JSON.stringify({ username, createdAt })} – subscription createdAt is before validFrom`,
            );

            return false;
        }

        return true;
    }

    private logToporBalancerDebug(
        req: Request,
        res: Response,
        body: unknown,
        clientType?: TRequestTemplateTypeKeys | 'browser-html',
    ): void {
        if (!this.isToporBalancerDebugEnabled) {
            return;
        }

        try {
            const bodyText = this.stringifyResponseBody(body);
            const decodedBase64BodyText = this.tryDecodeBase64(bodyText);
            const vlessLinksCount =
                this.countVlessLinks(bodyText) || this.countVlessLinks(decodedBase64BodyText);
            const contentTypeHeader = res.getHeader('content-type');
            const contentType = Array.isArray(contentTypeHeader)
                ? contentTypeHeader.join(', ')
                : contentTypeHeader?.toString() || null;

            this.logger.log(
                `[TOPOR_BALANCER_DEBUG] ${JSON.stringify({
                    path: req.path,
                    userAgent: req.headers['user-agent'] || null,
                    contentType,
                    bodyLength: Buffer.byteLength(bodyText),
                    detectedFormat: this.detectResponseFormat(
                        body,
                        bodyText,
                        decodedBase64BodyText,
                        contentType,
                        clientType,
                    ),
                    vlessLinksCount,
                })}`,
            );
        } catch (error) {
            this.logger.warn(`TOPOR_BALANCER_DEBUG logging failed: ${error}`);
        }
    }

    private stringifyResponseBody(body: unknown): string {
        if (typeof body === 'string') {
            return body;
        }

        if (Buffer.isBuffer(body)) {
            return body.toString('utf8');
        }

        if (body === null || body === undefined) {
            return '';
        }

        if (typeof body === 'object') {
            return JSON.stringify(body);
        }

        return String(body);
    }

    private detectResponseFormat(
        body: unknown,
        bodyText: string,
        decodedBase64BodyText: string,
        contentType: string | null,
        clientType?: TRequestTemplateTypeKeys | 'browser-html',
    ): string {
        const contentTypeLower = contentType?.toLowerCase() || '';

        if (clientType === 'browser-html' || contentTypeLower.includes('text/html')) {
            return 'browser-html';
        }

        if (
            contentTypeLower.includes('application/json') ||
            (!Buffer.isBuffer(body) && body !== null && typeof body === 'object')
        ) {
            return 'json';
        }

        if (this.countVlessLinks(bodyText) > 0) {
            return 'plain-subscription-links';
        }

        if (this.countVlessLinks(decodedBase64BodyText) > 0) {
            return 'base64-subscription-links';
        }

        if (clientType) {
            return `app-specific:${clientType}`;
        }

        return 'unknown';
    }

    private countVlessLinks(bodyText: string): number {
        return bodyText.match(/vless:\/\//g)?.length || 0;
    }

    private tryDecodeBase64(bodyText: string): string {
        const normalizedBodyText = bodyText.trim();

        if (!normalizedBodyText || normalizedBodyText.length % 4 !== 0) {
            return '';
        }

        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedBodyText)) {
            return '';
        }

        try {
            return Buffer.from(normalizedBodyText, 'base64').toString('utf8');
        } catch {
            return '';
        }
    }
}
