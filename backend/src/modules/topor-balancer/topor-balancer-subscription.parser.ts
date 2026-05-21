import type { ParsedSubscription, ParsedVlessLink, SubscriptionFormat } from './types';

export function detectSubscriptionFormat(body: string, contentType?: string): SubscriptionFormat {
    const normalizedContentType = contentType?.toLowerCase() || '';
    const trimmedBody = body.trim();

    if (normalizedContentType.includes('text/html') || looksLikeHtml(trimmedBody)) {
        return 'html';
    }

    if (normalizedContentType.includes('application/json') || looksLikeJson(trimmedBody)) {
        return 'json';
    }

    if (containsVlessLink(trimmedBody)) {
        return 'plain_links';
    }

    const decodedBody = tryDecodeBase64Subscription(trimmedBody);

    if (decodedBody !== null && containsVlessLink(decodedBody)) {
        return 'base64_links';
    }

    return 'unknown';
}

export function decodeSubscriptionBody(body: string, format: SubscriptionFormat): string {
    if (format === 'plain_links') {
        return body;
    }

    if (format === 'base64_links') {
        return tryDecodeBase64Subscription(body) ?? body;
    }

    return body;
}

export function encodeSubscriptionBody(
    plainBody: string,
    originalFormat: SubscriptionFormat,
    originalBody: string = plainBody,
): string {
    if (originalFormat === 'plain_links') {
        return plainBody;
    }

    if (originalFormat === 'base64_links') {
        return Buffer.from(plainBody, 'utf8').toString('base64');
    }

    return originalBody;
}

export function parseSubscription(
    rawSubscription: string,
    contentType?: string,
): ParsedSubscription {
    const format = detectSubscriptionFormat(rawSubscription, contentType);
    const subscriptionBody = decodeSubscriptionBody(rawSubscription, format);

    return {
        raw: rawSubscription,
        isBase64: format === 'base64_links',
        format,
        links:
            format === 'plain_links' || format === 'base64_links'
                ? extractVlessLinks(subscriptionBody)
                : [],
    };
}

export function extractVlessLinks(subscriptionBody: string): ParsedVlessLink[] {
    return subscriptionBody
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('vless://'))
        .map(parseVlessLink)
        .filter((link): link is ParsedVlessLink => link !== null);
}

export function parseVlessLink(link: string): ParsedVlessLink | null {
    if (!link.startsWith('vless://')) {
        return null;
    }

    try {
        const parsedUrl = new URL(link);

        if (parsedUrl.protocol !== 'vless:' || !parsedUrl.username || !parsedUrl.hostname) {
            return null;
        }

        const rawQuery = extractRawQuery(link);
        const queryParams = parseQueryParams(rawQuery);
        const remark = parseRemark(extractRawHash(link));

        return {
            raw: link,
            protocol: 'vless',
            uuid: parsedUrl.username,
            host: parsedUrl.hostname,
            port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
            params: queryParams,
            queryParams,
            rawQuery,
            remark,
            name: remark,
            security: queryParams.security,
            type: queryParams.type,
            sni: queryParams.sni,
            flow: queryParams.flow,
            pbk: queryParams.pbk,
            sid: queryParams.sid,
            fp: queryParams.fp,
            path: queryParams.path,
            serviceName: queryParams.serviceName,
            alpn: queryParams.alpn,
        };
    } catch {
        return null;
    }
}

export function replaceVlessRemark(link: string, newRemark: string): string {
    if (!link.startsWith('vless://')) {
        return link;
    }

    if (parseVlessLink(link) === null) {
        return link;
    }

    const hashIndex = link.indexOf('#');
    const linkWithoutRemark = hashIndex === -1 ? link : link.slice(0, hashIndex);

    let encodedRemark: string;

    try {
        encodedRemark = encodeURIComponent(newRemark);
    } catch {
        return link;
    }

    const replacedLink = `${linkWithoutRemark}#${encodedRemark}`;

    return parseVlessLink(replacedLink) === null ? link : replacedLink;
}

function extractRawQuery(link: string): string {
    const queryIndex = link.indexOf('?');

    if (queryIndex === -1) {
        return '';
    }

    const hashIndex = link.indexOf('#', queryIndex);

    return hashIndex === -1 ? link.slice(queryIndex + 1) : link.slice(queryIndex + 1, hashIndex);
}

function extractRawHash(link: string): string {
    const hashIndex = link.indexOf('#');

    return hashIndex === -1 ? '' : link.slice(hashIndex);
}

function parseQueryParams(rawQuery: string): Record<string, string> {
    const queryParams: Record<string, string> = {};

    if (!rawQuery) {
        return queryParams;
    }

    for (const part of rawQuery.split('&')) {
        if (!part) {
            continue;
        }

        const separatorIndex = part.indexOf('=');
        const rawKey = separatorIndex === -1 ? part : part.slice(0, separatorIndex);
        const rawValue = separatorIndex === -1 ? '' : part.slice(separatorIndex + 1);
        const key = safeDecodeURIComponent(rawKey.replace(/\+/g, '%20'));
        const value = safeDecodeURIComponent(rawValue.replace(/\+/g, '%20'));

        queryParams[key] = value;
    }

    return queryParams;
}

function parseRemark(rawHash: string): string | undefined {
    if (!rawHash) {
        return undefined;
    }

    return safeDecodeURIComponent(rawHash.slice(1));
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function containsVlessLink(body: string): boolean {
    return body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .some((line) => line.startsWith('vless://') && parseVlessLink(line) !== null);
}

function looksLikeHtml(body: string): boolean {
    const normalizedBody = body.toLowerCase();

    return (
        normalizedBody.startsWith('<!doctype html') ||
        normalizedBody.startsWith('<html') ||
        normalizedBody.includes('<body')
    );
}

function looksLikeJson(body: string): boolean {
    if (!body || (!body.startsWith('{') && !body.startsWith('['))) {
        return false;
    }

    try {
        JSON.parse(body);

        return true;
    } catch {
        return false;
    }
}

function tryDecodeBase64Subscription(rawSubscription: string): string | null {
    const normalizedSubscription = rawSubscription.replace(/\s+/g, '');

    if (
        !normalizedSubscription ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedSubscription)
    ) {
        return null;
    }

    try {
        const remainder = normalizedSubscription.length % 4;

        if (remainder === 1) {
            return null;
        }

        const paddedSubscription =
            remainder === 0
                ? normalizedSubscription
                : `${normalizedSubscription}${'='.repeat(4 - remainder)}`;
        const decodedSubscription = Buffer.from(paddedSubscription, 'base64').toString('utf8');

        if (!decodedSubscription.includes('vless://')) {
            return null;
        }

        return decodedSubscription;
    } catch {
        return null;
    }
}
