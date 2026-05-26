import {
    Alert,
    ActionIcon,
    Badge,
    Button,
    Card,
    Checkbox,
    Container,
    Group,
    Modal,
    NumberInput,
    PasswordInput,
    ScrollArea,
    Select,
    SimpleGrid,
    Stack,
    Switch,
    Table,
    Tabs,
    Text,
    TextInput,
    Tooltip,
    Title
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
    IconAlertTriangle,
    IconDatabase,
    IconDownload,
    IconLogout,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconShieldLock,
    IconTrash
} from '@tabler/icons-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

import { Page } from '@shared/ui'
import { defaultLocale, i18n } from '../../../i18n'

import classes from './topor-balancer-admin.module.css'

const ADMIN_TOKEN_STORAGE_KEY = 'toporBalancerAdminToken'
const ADMIN_HEALTH_URL = '/api/topor-balancer/health'
const ADMIN_GROUPS_URL = '/api/topor-balancer/groups'
const ADMIN_NODES_URL = '/api/topor-balancer/nodes'
const ADMIN_ASSIGNMENTS_URL = '/api/topor-balancer/assignments'
const ADMIN_REQUESTS_URL = '/api/topor-balancer/requests'
const ADMIN_TRACES_URL = '/api/topor-balancer/diagnostics/traces'
const DISCOVERY_API_URL = '/api/topor-balancer/discovery/remnawave'
const DISCOVERY_SUBSCRIPTION_URL = '/api/topor-balancer/discovery/subscription'
const DISCOVERY_IMPORT_URL = '/api/topor-balancer/discovery/import'
const groupDiscoveryApiUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/remnawave`
const groupRecentDiagnosticsUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/diagnostics/recent`
const groupDiscoveryRefreshUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/refresh`
const groupDiscoverySubscriptionUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/subscription`
const groupNodesImportUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/nodes/import`
const SUBSCRIPTION_DIAGNOSTICS_URL = '/api/topor-balancer/diagnostics/subscription'
const RUNTIME_CONFIG_HEALTH_URL = '/api/topor-balancer/runtime-config-health'
const REMNAWAVE_TOPOLOGY_URL = '/api/topor-balancer/remnawave-topology'
const REMNAWAVE_TOPOLOGY_REFRESH_URL = '/api/topor-balancer/remnawave-topology/refresh'

const NODE_STATUSES = ['active', 'draining', 'disabled', 'dead'] as const
const texts = i18n[defaultLocale].toporBalancerAdmin
const DIAGNOSTICS_USER_AGENTS = [
    { label: 'v2rayNG', value: 'v2rayNG/1.9.0' },
    { label: 'v2RayTun', value: 'v2RayTun/6.0' },
    { label: 'Hiddify', value: 'Hiddify/2.0' },
    { label: 'Happ', value: 'Happ/1.0' },
    { label: 'Свой клиент', value: 'custom' }
] as const

type ToporBalancerNodeStatus = (typeof NODE_STATUSES)[number]
type ToporBalancerGroupStrategy = 'least_loaded' | 'manual' | 'priority_failover' | 'sticky_hash' | 'weighted'
type ToporBalancerGroupSquadScope = 'any_visible_to_user' | 'specific_internal_squad'
type DiscoveryItemStatus = 'conflict' | 'free' | 'in_other_group' | 'in_this_group' | 'not_accessible_to_selected_squad'

interface ToporBalancerHealth {
    assignmentCount: number
    assignmentMode: string
    configLoaded: boolean
    databaseConnected: boolean
    enabled: boolean
    lastError?: string
    nodeCount: number
    remnawavePanelUrl?: string
    requestCount?: number
}

interface RuntimeConfigHealth {
    appConfigRoute: string
    fallbackConfigOk: boolean
    lastConfigSource: string | null
    lastRuntimeConfigError: string | null
}

interface ToporBalancerGroup {
    activeNodesCount: number
    assignedUsers: number
    enabled: boolean
    id: string
    locationCode?: string
    nodesCount: number
    nodesCountSource?: 'db_group_id'
    planCode: string
    publicHostCode: string
    publicName: string
    squadScope: ToporBalancerGroupSquadScope
    internalSquadUuid?: string
    strategy: ToporBalancerGroupStrategy
    updatedAt?: string
}

interface ToporBalancerNode {
    assignedUsers: number
    groupId?: string
    id: string
    locationCode?: string
    maxUsers: number
    planCode: string
    publicHostCode: string
    publicName: string
    status: ToporBalancerNodeStatus
    technicalHostName: string
    updatedAt?: string
    weight: number
}

interface ToporBalancerAssignment {
    createdAt?: string
    id: string
    nodeId: string
    planCode: string
    publicHostCode: string
    shortUuid: string
    technicalHostName?: string
    updatedAt?: string
}

interface AssignmentActionSummary {
    errors: Array<{ reason: string; shortUuid?: string }>
    reassigned: number
    removed: number
    skipped: number
}

interface ToporBalancerRequest {
    createdAt?: string
    errorMessage?: string
    id: string
    inputLinksCount?: number
    outputLinksCount?: number
    responseFormat?: string
    shortUuid: string
    status?: string
}

interface GroupRuntimeDiagnostic {
    time?: string
    shortUuid: string
    userAgent?: string
    totalLinks?: number
    matchedLinks?: number
    rewrittenLinks?: number
    selectedNode?: string
    status?: string
    warnings: string[]
    groupDiagnostic?: {
        publicHostCode: string
        planCode: string
        subscriptionCandidateNodes: string[]
        effectiveCandidateNodes: string[]
        selectedTechnicalHostName?: string
        previousAssignedNode?: string
        previousAssignedNodeStatus?: string
        failOpenReason?: string
        excludedNodes: Array<{ reason: string; technicalHostName: string; message: string }>
        warnings: string[]
    }
}

interface SubscriptionTrace {
    id: string
    request: {
        timestamp: string
        shortUuid: string
        userAgent?: string
        flow: 'browser' | 'raw'
    }
    upstream: {
        vlessLinksCount: number
        unsupportedAppFallback: boolean
    }
    balancer: {
        matchedTechnicalLinks: number
        rewrittenLinksCount: number
        status: string
        unsupportedAppFallback: boolean
    }
}

interface DiscoveredHost {
    alreadyImported: boolean
    canAdd?: boolean
    currentGroupId?: null | string
    currentGroupName?: null | string
    flow?: string
    host?: string
    matchedGroupId?: string
    matchedGroupPlanCode?: string
    matchedGroupPublicHostCode?: string
    matchedNodeId: string | null
    membershipStatus?: DiscoveryItemStatus
    pbk?: string
    port?: number
    protocol?: 'vless'
    rawRemark?: string
    remnawaveNodeName?: string
    remnawaveNodeUuid?: string
    remnawaveInboundName?: string
    remnawaveProfileName?: string
    accessibleSquads?: Array<{ name: string; uuid: string }>
    squadStatus?: 'accessible' | 'not_accessible_to_selected_squad' | 'unknown'
    security?: string
    sid?: string
    sni?: string
    technicalHostName: string
    type?: string
    status?: DiscoveryItemStatus
}

interface RemnawaveTopologySnapshot {
    hosts: Array<{
        uuid: string
        remark: string
        address?: string
        nodeName?: string
        profileName?: string
        inboundName?: string
        accessibleSquads: Array<{ name: string; uuid: string }>
    }>
    nodes: Array<{ uuid: string; name: string; status?: string }>
    inbounds: Array<{ uuid: string; name: string; profileName?: string }>
    squads: Array<{ uuid: string; name: string }>
    warnings: string[]
    refreshedAt?: string
}

interface DiscoveryResponse {
    group?: {
        id: string
        planCode: string
        publicHostCode: string
        publicName: string
    }
    items: DiscoveredHost[]
    message?: string
    shortUuid?: string
    source: 'remnawave-api' | 'subscription'
}

interface ImportConflict {
    existingGroupId?: string
    existingPlanCode?: string
    existingPublicHostCode?: string
    existingPublicName?: string
    reason: string
    technicalHostName: string
}

interface GroupImportConflict {
    currentGroupId?: string
    currentGroupName?: string
    technicalHostName: string
}

interface ImportResult {
    alreadyInGroup?: Array<{ nodeId?: string; technicalHostName: string }>
    conflicts?: ImportConflict[]
    created: ToporBalancerNode[]
    errors?: Array<{ reason: string; technicalHostName?: string }>
    inOtherGroup?: GroupImportConflict[]
    skipped?: Array<{ reason: string; technicalHostName: string }>
    updated?: ToporBalancerNode[]
}

type ImportMode = 'existing' | 'new'
type DiscoveryImportStatus = 'conflict' | 'error' | 'imported' | 'skipped'

interface DiscoveryImportStatusState {
    message?: string
    status: DiscoveryImportStatus
}

interface SubscriptionDiagnosticsResult {
    ok: boolean
    status: 'failed_open' | 'partially_processed' | 'passed_through' | 'processed' | 'unsupported_app'
    format: 'base64_links' | 'plain_links' | 'unknown'
    totalVlessLinks: number
    matchedTechnicalLinks: number
    userSquads: Array<{ name: string; uuid: string }>
    accessibleNodesCount: number
    unmatchedRemarks: string[]
    linkDiagnostics: Array<{
        visibleRemark?: string
        normalizedRemark?: string
        remarkLength: number
        matchesTechnicalHostName: boolean
        matchedTechnicalHostName?: string
        matchedPublicHostCode?: string
        matchedPlanCode?: string
        configuredTechnicalHostNames: string[]
        closestTechnicalHostNameCandidates: string[]
        reason?:
            | 'exact_mismatch'
            | 'group_disabled'
            | 'invisible_characters'
            | 'leading_trailing_whitespace'
            | 'node_inactive'
            | 'not_configured'
            | 'unsupported_app'
            | 'unicode_normalization_mismatch'
        normalizedComparisonResult: 'matched' | 'not_matched'
    }>
    matchedGroups: Array<{
        publicHostCode: string
        planCode: string
        publicName: string
        technicalHostNames: string[]
        matchedRemarks: string[]
        selectedTechnicalHostName?: string
        userSquads: Array<{ name: string; uuid: string }>
        accessibleNodesCount: number
        groupNodesCount: number
        subscriptionCandidateNodes: string[]
        effectiveCandidateNodes: string[]
        excludedNodes: Array<{
            technicalHostName: string
            reason:
                | 'missing_topology'
                | 'not_accessible_to_group_squad'
                | 'not_accessible_to_user_squad'
                | 'not_in_subscription'
                | 'user_not_in_group_squad'
            message: string
        }>
        outputRemarks: string[]
        outputContainsPublicName: boolean
        rewrittenLinksCount: number
        unchangedLinksCount: number
        unchangedReasons: Array<{
            reason: DiagnosticsUnchangedReason
            remark?: string
            technicalHostName?: string
            message: string
        }>
    }>
    selectedNodes: Record<string, string>
    rewrittenLinksCount: number
    unchangedLinksCount: number
    unchangedReasons: Array<{
        publicHostCode?: string
        planCode?: string
        reason: DiagnosticsUnchangedReason
        remark?: string
        technicalHostName?: string
        message: string
    }>
    reasons: Array<{
        publicHostCode?: string
        planCode?: string
        reason: DiagnosticsUnchangedReason
        remark?: string
        technicalHostName?: string
        message: string
    }>
    inputLinksCount: number
    outputLinksCount: number
    groups: Array<{
        publicHostCode: string
        planCode: string
        publicName?: string
        selectedTechnicalHostName?: string
        status: 'fail-open' | 'no-active-node' | 'ok' | 'partial' | 'passed-through'
    }>
    vlessValidation: Array<{
        remark?: string
        valid: boolean
        warnings: string[]
        queryParamKeys: string[]
    }>
    warnings: string[]
    errors: string[]
}

type DiagnosticsUnchangedReason =
    | 'exact_mismatch'
    | 'format_unsupported'
    | 'group_disabled'
    | 'invisible_characters'
    | 'leading_trailing_whitespace'
    | 'no_active_node'
    | 'no_accessible_candidates'
    | 'no_selected_node'
    | 'node_inactive'
    | 'not_configured'
    | 'technicalHostName_mismatch'
    | 'unsupported_app'
    | 'unicode_normalization_mismatch'

const statusLabels: Record<ToporBalancerNodeStatus, string> = {
    active: texts.status.active,
    dead: texts.status.dead,
    disabled: texts.status.disabled,
    draining: texts.status.draining
}

const statusTooltips: Record<ToporBalancerNodeStatus, string> = {
    active: texts.tooltips.active,
    dead: texts.tooltips.dead,
    disabled: texts.tooltips.disabled,
    draining: texts.tooltips.draining
}

const tooltips = texts.tooltips

function formatText(template: string, values: Record<string, number | string>) {
    return Object.entries(values).reduce((current, [key, value]) => current.replaceAll('{{' + key + '}}', String(value)), template)
}

function getAdminErrorMessage(error: unknown, fallback: string) {
    if (!(error instanceof Error)) {
        return fallback
    }

    if (error.message.includes('Unexpected token')) {
        return 'Админ-интерфейс получил некорректный ответ. Проверьте, что серверная часть запущена и доступна.'
    }

    return error.message
}

function Help({ label }: { label: string }) {
    const [opened, setOpened] = useState(false)

    return (
        <Tooltip label={label} maw={360} multiline opened={opened} withArrow>
            <ActionIcon
                aria-expanded={opened}
                aria-label={label}
                className={classes.helpIcon}
                onBlur={() => setOpened(false)}
                onClick={(event) => {
                    event.preventDefault()
                    setOpened((current) => !current)
                }}
                onFocus={() => setOpened(true)}
                onMouseEnter={() => setOpened(true)}
                onMouseLeave={() => setOpened(false)}
                onTouchStart={(event) => {
                    event.preventDefault()
                    setOpened((current) => !current)
                }}
                radius="xl"
                size="xs"
                tabIndex={0}
                variant="subtle"
            >
                ?
            </ActionIcon>
        </Tooltip>
    )
}

function FieldLabel({ help, label }: { help?: string; label: string }) {
    return (
        <Group gap={4} wrap="nowrap">
            <Text component="span" fw={500} size="sm">
                {label}
            </Text>
            {help && <Help label={help} />}
        </Group>
    )
}

function HeaderWithHelp({ children, help }: { children: string; help: string }) {
    return (
        <Group gap={4} wrap="nowrap">
            {children}
            <Help label={help} />
        </Group>
    )
}

function getStatusColor(status: ToporBalancerNodeStatus) {
    const colors: Record<ToporBalancerNodeStatus, string> = {
        active: 'green',
        dead: 'red',
        disabled: 'gray',
        draining: 'yellow'
    }

    return colors[status]
}

function formatDate(value?: string) {
    if (!value) {
        return '-'
    }

    const date = new Date(value)

    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU')
}

function maskShort(value: string) {
    if (value.length <= 8) {
        return `${value.slice(0, 2)}***`
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function maskSecret(value?: string) {
    if (!value) {
        return '-'
    }

    if (value.length <= 8) {
        return `${value.slice(0, 2)}***`
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function redactSensitiveText(value?: string) {
    if (!value) {
        return '-'
    }

    return value
        .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer [${texts.common.hidden}]`)
        .replace(/(token|key|secret|password)=([^&\s]+)/gi, `$1=[${texts.common.hidden}]`)
        .replace(/vless:\/\/[^\s]+/gi, `[${texts.common.linkHidden}]`)
        .replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi, `[${texts.common.uuidHidden}]`)
        .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, `[${texts.common.ipHidden}]`)
}

function safeArray<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : []
}

function statusOptions() {
    return NODE_STATUSES.map((status) => ({
        label: statusLabels[status],
        value: status
    }))
}

const strategyOptions: Array<{ label: string; value: ToporBalancerGroupStrategy }> = [
    { label: 'Минимальная нагрузка', value: 'least_loaded' },
    { label: 'Взвешенная', value: 'weighted' },
    { label: 'Ручная', value: 'manual' },
    { label: 'Приоритетный резерв', value: 'priority_failover' },
    { label: 'Статический хеш', value: 'sticky_hash' }
]

const strategyTooltips: Record<ToporBalancerGroupStrategy, string> = {
    least_loaded: 'Новые назначения идут на активную ноду с минимальной эффективной нагрузкой: назначения / (лимит пользователей * вес).',
    manual: 'Новые пользователи не назначаются автоматически. Используются только существующие ручные назначения, иначе подписка сохраняет исходные ссылки.',
    priority_failover: 'Выбирается первая активная нода по приоритету. Если основная недоступна, используется следующая.',
    sticky_hash: 'Статический выбор по идентификатору пользователя. Без БД стабилен, но может измениться при изменении списка нод.',
    weighted: 'Новые назначения распределяются по весам. Ноды с большим весом получают больше пользователей; лимит пользователей учитывается как мягкий.'
}

function StrategyLegend() {
    return (
        <Group gap={6}>
            {strategyOptions.map((strategy) => (
                <Group gap={4} key={strategy.value} wrap="nowrap">
                    <Badge className={classes.strategyBadge} variant="light">
                        {strategy.label}
                    </Badge>
                    <Help label={strategyTooltips[strategy.value]} />
                </Group>
            ))}
        </Group>
    )
}

function StatusLegend() {
    return (
        <Group gap={6}>
            {NODE_STATUSES.map((status) => (
                <Group gap={4} key={status} wrap="nowrap">
                    <Badge color={getStatusColor(status)} variant="light">
                        {statusLabels[status]}
                    </Badge>
                    <Help label={statusTooltips[status]} />
                </Group>
            ))}
        </Group>
    )
}

function normalizeTechnicalHostName(value: string) {
    return value.replace(/[\u00A0\u202F\u2007]/g, ' ').normalize('NFC').trim()
}

function getPublicHostCodeWarning(value: string) {
    const normalizedValue = value.trim().toLowerCase()

    if (normalizedValue === 'fl_standart') {
        return '"fl_standart" looks like typo, expected "fi_standard"'
    }

    if (normalizedValue.includes('standart')) {
        return '"standart" looks like typo, expected "standard"'
    }

    return undefined
}

function getPlanCodeWarning(value: string) {
    return value.trim().toLowerCase() === 'standart'
        ? '"standart" looks like typo, expected "standard"'
        : undefined
}

function getDiagnosticsStatusColor(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const colors: Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string> = {
        'fail-open': 'yellow',
        'no-active-node': 'red',
        'passed-through': 'yellow',
        partial: 'yellow',
        ok: 'green'
    }

    return colors[status]
}

function getDiagnosticsStatusLabel(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const labels: Partial<Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string>> = {
        'fail-open': 'Исходные ссылки',
        'no-active-node': 'Нет активной ноды',
        ok: 'Обработана',
        partial: 'Обработана частично',
        'passed-through': 'Без изменений'
    }

    return labels[status] ?? status
}

function getDiagnosticsOverallStatusColor(status: SubscriptionDiagnosticsResult['status']) {
    const colors: Record<SubscriptionDiagnosticsResult['status'], string> = {
        failed_open: 'red',
        partially_processed: 'yellow',
        passed_through: 'yellow',
        processed: 'green',
        unsupported_app: 'red'
    }

    return colors[status]
}

function getDiagnosticsOverallStatusLabel(status: SubscriptionDiagnosticsResult['status']) {
    if (status === 'unsupported_app') {
        return 'Приложение не поддержано'
    }

    const labels: Partial<Record<SubscriptionDiagnosticsResult['status'], string>> = {
        failed_open: 'Ошибка, отдана исходная подписка',
        partially_processed: 'Подписка обработана частично',
        passed_through: 'Подписка прошла без изменений',
        processed: 'Balancer обработал подписку'
    }

    return labels[status] ?? status
}

function getDiagnosticsReasonLabel(reason: DiagnosticsUnchangedReason) {
    if (reason === 'unsupported_app') {
        return 'Приложение не поддержано'
    }

    const labels: Partial<Record<DiagnosticsUnchangedReason, string>> = {
        exact_mismatch: 'Точное совпадение не найдено',
        format_unsupported: 'Формат не поддерживается',
        group_disabled: 'Группа отключена',
        invisible_characters: 'Есть невидимые символы',
        leading_trailing_whitespace: 'Пробелы по краям',
        no_active_node: 'Нет активных нод',
        no_accessible_candidates: 'Нода недоступна пользователю по squad',
        no_selected_node: 'Нода не выбрана',
        node_inactive: 'Нода не активна',
        not_configured: 'Не настроено',
        technicalHostName_mismatch: 'Не найдено совпадений technicalHostName',
        unicode_normalization_mismatch: 'Unicode отличается после нормализации'
    }

    return labels[reason] ?? reason
}

function getSubscriptionFormatLabel(format: SubscriptionDiagnosticsResult['format']) {
    const labels: Record<SubscriptionDiagnosticsResult['format'], string> = {
        base64_links: 'Base64 со ссылками',
        plain_links: 'Обычный список ссылок',
        unknown: 'Неизвестный'
    }

    return labels[format]
}

function getTraceFlowLabel(flow: SubscriptionTrace['request']['flow']) {
    const labels: Record<SubscriptionTrace['request']['flow'], string> = {
        browser: 'Браузер',
        raw: 'Сырые данные'
    }

    return labels[flow]
}

function getDiscoveryStatusLabel(status?: DiscoveryItemStatus) {
    const labels: Record<DiscoveryItemStatus, string> = {
        conflict: 'Конфликт',
        free: 'Свободна',
        in_other_group: 'В другой группе',
        in_this_group: 'В этой группе',
        not_accessible_to_selected_squad: 'Недоступна squad группы'
    }

    return status ? labels[status] : 'Свободна'
}

function getRuntimeStatusLabel(status?: string) {
    const labels: Record<string, string> = {
        failed_open: 'Ошибка, отдана исходная подписка',
        no_active_candidates: 'Нет активных кандидатов',
        no_effective_candidates: 'Нет эффективных кандидатов',
        partially_processed: 'Обработано частично',
        passed_through: 'Без изменений',
        processed: 'Обработано',
        unsupported_app: 'Приложение не поддержано'
    }

    return status ? labels[status] ?? status : '-'
}

function getAssignmentModeLabel(mode?: string) {
    const labels: Record<string, string> = {
        database: 'База данных',
        hash: 'Хеш'
    }

    return mode ? labels[mode] ?? mode : '-'
}

export function ToporBalancerAdminPage() {
    const [tokenInput, setTokenInput] = useState('')
    const [adminToken, setAdminToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY))
    const [health, setHealth] = useState<null | ToporBalancerHealth>(null)
    const [runtimeHealth, setRuntimeHealth] = useState<null | RuntimeConfigHealth>(null)
    const [groups, setGroups] = useState<ToporBalancerGroup[]>([])
    const [nodes, setNodes] = useState<ToporBalancerNode[]>([])
    const [groupNodes, setGroupNodes] = useState<ToporBalancerNode[]>([])
    const [groupNodesGroupId, setGroupNodesGroupId] = useState<null | string>(null)
    const [isGroupNodesLoading, setIsGroupNodesLoading] = useState(false)
    const [assignments, setAssignments] = useState<ToporBalancerAssignment[]>([])
    const [groupRuntimeDiagnostics, setGroupRuntimeDiagnostics] = useState<GroupRuntimeDiagnostic[]>([])
    const [requests, setRequests] = useState<ToporBalancerRequest[]>([])
    const [subscriptionTraces, setSubscriptionTraces] = useState<SubscriptionTrace[]>([])
    const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([])
    const [selectedHosts, setSelectedHosts] = useState<string[]>([])
    const [showOnlyFreeDiscovery, setShowOnlyFreeDiscovery] = useState(true)
    const [nodeDiscoverySearch, setNodeDiscoverySearch] = useState('')
    const [nodeDiscoveryFilter, setNodeDiscoveryFilter] = useState<string | null>(null)
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
    const [assignmentNodeFilter, setAssignmentNodeFilter] = useState<string | null>(null)
    const [groupSearch, setGroupSearch] = useState('')
    const [isCreateGroupModalOpen, setIsCreateGroupModalOpen] = useState(false)
    const [isGroupEditorOpen, setIsGroupEditorOpen] = useState(false)
    const [groupEditorTab, setGroupEditorTab] = useState('overview')
    const [discoveryImportStatuses, setDiscoveryImportStatuses] = useState<Record<string, DiscoveryImportStatusState>>({})
    const [errorMessage, setErrorMessage] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [isDiscoveryLoading, setIsDiscoveryLoading] = useState(false)
    const [isDiagnosticsLoading, setIsDiagnosticsLoading] = useState(false)
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)
    const [importMode, setImportMode] = useState<ImportMode>('existing')
    const [importTargetGroupId, setImportTargetGroupId] = useState<string | null>(null)
    const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null)
    const [lastDiscoverySource, setLastDiscoverySource] = useState<DiscoveryResponse['source'] | null>(null)
    const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null)
    const [shortUuid, setShortUuid] = useState('')
    const [diagnosticsShortUuid, setDiagnosticsShortUuid] = useState('')
    const [diagnosticsUserAgentPreset, setDiagnosticsUserAgentPreset] = useState('v2RayTun/6.0')
    const [diagnosticsCustomUserAgent, setDiagnosticsCustomUserAgent] = useState('v2RayTun/6.0')
    const [subscriptionDiagnostics, setSubscriptionDiagnostics] = useState<SubscriptionDiagnosticsResult | null>(null)
    const [groupForm, setGroupForm] = useState({
        enabled: true,
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: '🇫🇮 Финляндия',
        squadScope: 'any_visible_to_user' as ToporBalancerGroupSquadScope,
        internalSquadUuid: '',
        strategy: 'least_loaded' as ToporBalancerGroupStrategy
    })
    const [nodeForm, setNodeForm] = useState({
        maxUsers: 300,
        status: 'active' as ToporBalancerNodeStatus,
        technicalHostName: '',
        weight: 1
    })
    const [importDefaults, setImportDefaults] = useState({
        maxUsers: 300,
        status: 'active' as ToporBalancerNodeStatus,
        weight: 1
    })
    const [importGroupForm, setImportGroupForm] = useState({
        internalSquadUuid: '',
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        squadScope: 'any_visible_to_user' as ToporBalancerGroupSquadScope,
        publicName: '🇫🇮 Финляндия'
    })

    const [topology, setTopology] = useState<RemnawaveTopologySnapshot | null>(null)

    const isLoggedIn = Boolean(adminToken)
    const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null
    const fallbackSelectedGroupNodes = useMemo(
        () => nodes.filter((node) => selectedGroup && node.groupId === selectedGroup.id),
        [nodes, selectedGroup]
    )
    const selectedGroupNodes = useMemo(
        () => {
            if (!selectedGroup) {
                return []
            }

            return groupNodesGroupId === selectedGroup.id ? groupNodes : fallbackSelectedGroupNodes
        },
        [fallbackSelectedGroupNodes, groupNodes, groupNodesGroupId, selectedGroup]
    )
    const selectedGroupNodeCounterMismatch =
        !isGroupNodesLoading &&
        Boolean(selectedGroup) &&
        groupNodesGroupId === selectedGroup?.id &&
        selectedGroupNodes.length !== selectedGroup?.nodesCount
    const selectedGroupAssignments = useMemo(() => {
        const selectedNodeIds = new Set(selectedGroupNodes.map((node) => node.id))

        return assignments.filter((assignment) => selectedNodeIds.has(assignment.nodeId))
    }, [assignments, selectedGroupNodes])
    const groupNodeDiscoveryRows = useMemo(() => {
        const rowsByName = new Map(
            discoveredHosts.map((host) => [normalizeTechnicalHostName(host.technicalHostName), host])
        )

        for (const node of selectedGroupNodes) {
            const technicalHostName = normalizeTechnicalHostName(node.technicalHostName)

            if (!rowsByName.has(technicalHostName)) {
                rowsByName.set(technicalHostName, {
                    alreadyImported: true,
                    canAdd: false,
                    currentGroupId: selectedGroup?.id ?? node.groupId ?? null,
                    currentGroupName: selectedGroup?.publicName ?? node.publicName,
                    matchedNodeId: node.id,
                    membershipStatus: 'in_this_group',
                    status: 'in_this_group',
                    technicalHostName
                })
            }
        }

        const query = nodeDiscoverySearch.trim().toLowerCase()

        return Array.from(rowsByName.values()).filter((host) => {
            const status = host.membershipStatus ?? host.status
            const inThisGroup = status === 'in_this_group'
            const searchable = [
                host.technicalHostName,
                host.currentGroupName,
                host.remnawaveNodeName,
                host.remnawaveInboundName,
                host.remnawaveProfileName,
                host.host,
                host.sni,
                ...(host.accessibleSquads?.map((squad) => squad.name) ?? [])
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()

            if (showOnlyFreeDiscovery && !inThisGroup && status !== 'free') {
                return false
            }

            if (nodeDiscoveryFilter && !inThisGroup) {
                const matchesFilter =
                    status === nodeDiscoveryFilter ||
                    host.security === nodeDiscoveryFilter ||
                    host.type === nodeDiscoveryFilter ||
                    host.remnawaveProfileName === nodeDiscoveryFilter ||
                    host.accessibleSquads?.some((squad) => squad.name === nodeDiscoveryFilter)

                if (!matchesFilter) {
                    return false
                }
            }

            return !query || searchable.includes(query)
        })
    }, [discoveredHosts, nodeDiscoveryFilter, nodeDiscoverySearch, selectedGroup, selectedGroupNodes, showOnlyFreeDiscovery])
    const filteredGroups = useMemo(() => {
        const query = groupSearch.trim().toLowerCase()

        if (!query) {
            return groups
        }

        return groups.filter((group) =>
            [
                group.publicName,
                group.publicHostCode,
                group.locationCode,
                group.planCode,
                group.strategy
            ]
                .filter(Boolean)
                .some((value) => value?.toLowerCase().includes(query))
        )
    }, [groupSearch, groups])
    const discoveredByTechnicalHostName = useMemo(
        () =>
            new Map(
                discoveredHosts.map((host) => [
                    normalizeTechnicalHostName(host.technicalHostName),
                    host
                ])
            ),
        [discoveredHosts]
    )
    const importedByTechnicalHostName = useMemo(
        () => new Map(nodes.map((node) => [normalizeTechnicalHostName(node.technicalHostName), node])),
        [nodes]
    )

    const fetchAdminJson = useCallback(
        async <ResponseBody,>(url: string, options?: RequestInit): Promise<ResponseBody | null> => {
            if (!adminToken) {
                return null
            }

            const response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Bearer ${adminToken}`,
                    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
                    ...options?.headers
                }
            })

            if (response.status === 401 || response.status === 403) {
                localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
                setAdminToken(null)
                setErrorMessage(texts.messages.invalidAdminToken)
                return null
            }

            if (!response.ok) {
                const body = await response.text()
                throw new Error(body || formatText(texts.messages.adminApiStatus, { status: response.status }))
            }

            return (await response.json()) as ResponseBody
        },
        [adminToken]
    )

    const refreshGroupEditorData = useCallback(
        async (groupId: string) => {
            setIsGroupNodesLoading(true)

            try {
                const [groupResponse, groupNodesResponse, groupDiagnosticsResponse] = await Promise.all([
                    fetchAdminJson<ToporBalancerGroup>(`${ADMIN_GROUPS_URL}/${groupId}`),
                    fetchAdminJson<ToporBalancerNode[]>(`${ADMIN_GROUPS_URL}/${groupId}/nodes`),
                    fetchAdminJson<GroupRuntimeDiagnostic[]>(groupRecentDiagnosticsUrl(groupId))
                ])
                const nextGroupNodes = safeArray<ToporBalancerNode>(groupNodesResponse)

                if (groupResponse) {
                    setGroups((current) =>
                        current.map((group) => (group.id === groupResponse.id ? groupResponse : group))
                    )
                }

                setGroupNodesGroupId(groupId)
                setGroupNodes(nextGroupNodes)
                setGroupRuntimeDiagnostics(safeArray<GroupRuntimeDiagnostic>(groupDiagnosticsResponse))
                setNodes((current) => [
                    ...current.filter((node) => node.groupId !== groupId),
                    ...nextGroupNodes
                ])
            } finally {
                setIsGroupNodesLoading(false)
            }
        },
        [fetchAdminJson]
    )

    const refreshAdminData = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsLoading(true)
        setErrorMessage('')

        try {
            const [healthResponse, runtimeResponse, groupsResponse, nodesResponse, assignmentsResponse, requestsResponse, tracesResponse, topologyResponse] =
                await Promise.all([
                    fetchAdminJson<ToporBalancerHealth>(ADMIN_HEALTH_URL),
                    fetchAdminJson<RuntimeConfigHealth>(RUNTIME_CONFIG_HEALTH_URL),
                    fetchAdminJson<ToporBalancerGroup[]>(ADMIN_GROUPS_URL),
                    fetchAdminJson<ToporBalancerNode[]>(ADMIN_NODES_URL),
                    fetchAdminJson<ToporBalancerAssignment[]>(ADMIN_ASSIGNMENTS_URL),
                    fetchAdminJson<ToporBalancerRequest[]>(ADMIN_REQUESTS_URL),
                    fetchAdminJson<SubscriptionTrace[]>(ADMIN_TRACES_URL),
                    fetchAdminJson<RemnawaveTopologySnapshot>(REMNAWAVE_TOPOLOGY_URL)
                ])

            if (healthResponse) {
                setHealth(healthResponse)
            }

            if (runtimeResponse) {
                setRuntimeHealth(runtimeResponse)
            }

            const nextGroups = safeArray<ToporBalancerGroup>(groupsResponse)

            setGroups(nextGroups)
            setNodes(safeArray<ToporBalancerNode>(nodesResponse))
            setAssignments(safeArray<ToporBalancerAssignment>(assignmentsResponse).slice(0, 500))
            setRequests(safeArray<ToporBalancerRequest>(requestsResponse).slice(0, 500))
            setSubscriptionTraces(safeArray<SubscriptionTrace>(tracesResponse).slice(0, 50))
            setTopology(topologyResponse)
            setSelectedGroupId((current) => current ?? nextGroups[0]?.id ?? null)
            setLastRefreshAt(new Date())
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.adminApiLoadFailed))
        } finally {
            setIsLoading(false)
        }
    }, [adminToken, fetchAdminJson])

    useEffect(() => {
        if (adminToken) {
            refreshAdminData()
        }
    }, [adminToken, refreshAdminData])

    const saveToken = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmedToken = tokenInput.trim()

        if (!trimmedToken) {
            return
        }

        localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, trimmedToken)
        setAdminToken(trimmedToken)
        setTokenInput('')
        setErrorMessage('')
    }

    const logout = () => {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY)
        setAdminToken(null)
        setHealth(null)
        setRuntimeHealth(null)
        setGroups([])
        setNodes([])
        setGroupNodes([])
        setGroupNodesGroupId(null)
        setIsGroupNodesLoading(false)
        setAssignments([])
        setRequests([])
        setTopology(null)
        setDiscoveredHosts([])
        setSelectedHosts([])
        setSelectedGroupId(null)
        setDiscoveryImportStatuses({})
        setLastImportResult(null)
        setLastDiscoverySource(null)
        setSubscriptionDiagnostics(null)
    }

    const createGroup = async () => {
        if (!groupForm.publicHostCode.trim() || !groupForm.publicName.trim() || !groupForm.planCode.trim()) {
            notifications.show({
                color: 'red',
                message: texts.messages.requiredGroupFields,
                title: texts.messages.missingData
            })
            return
        }

        setIsLoading(true)

        try {
            const group = await fetchAdminJson<ToporBalancerGroup>(ADMIN_GROUPS_URL, {
                body: JSON.stringify({
                    enabled: groupForm.enabled,
                    locationCode: groupForm.locationCode.trim() || undefined,
                    planCode: groupForm.planCode.trim(),
                    publicHostCode: groupForm.publicHostCode.trim(),
                    publicName: groupForm.publicName.trim(),
                    squadScope: groupForm.squadScope,
                    internalSquadUuid:
                        groupForm.squadScope === 'specific_internal_squad'
                            ? groupForm.internalSquadUuid.trim()
                            : undefined,
                    strategy: groupForm.strategy
                }),
                method: 'POST'
            })

            await refreshAdminData()
            setSelectedGroupId(group?.id ?? null)
            setIsCreateGroupModalOpen(false)
            setGroupEditorTab('overview')
            setIsGroupEditorOpen(Boolean(group?.id))
            notifications.show({ color: 'green', message: texts.messages.groupCreated, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.groupCreateFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const patchGroup = async (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => {
        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerGroup>(`${ADMIN_GROUPS_URL}/${group.id}`, {
                body: JSON.stringify(patch),
                method: 'PATCH'
            })
            await refreshAdminData()
            await refreshGroupEditorData(group.id)
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.groupUpdateFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const deleteGroup = async (group: ToporBalancerGroup) => {
        setIsLoading(true)

        try {
            await fetchAdminJson<{ deleted: true }>(`${ADMIN_GROUPS_URL}/${group.id}`, {
                method: 'DELETE'
            })
            await refreshAdminData()
            setSelectedGroupId(null)
            setIsGroupEditorOpen(false)
            notifications.show({ color: 'green', message: texts.messages.groupDeleted, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.groupDeleteFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const createNode = async () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.messages.selectGroupFirst, title: texts.common.noGroup })
            return
        }

        if (!nodeForm.technicalHostName.trim()) {
            notifications.show({ color: 'red', message: texts.messages.technicalHostRequired, title: texts.messages.missingData })
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerNode>(`${ADMIN_GROUPS_URL}/${selectedGroup.id}/nodes`, {
                body: JSON.stringify({
                    maxUsers: nodeForm.maxUsers,
                    status: nodeForm.status,
                    technicalHostName: nodeForm.technicalHostName.trim(),
                    weight: nodeForm.weight
                }),
                method: 'POST'
            })
            setNodeForm((current) => ({ ...current, technicalHostName: '' }))
            await refreshAdminData()
            await refreshGroupEditorData(selectedGroup.id)
            notifications.show({ color: 'green', message: texts.messages.nodeAdded, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.nodeAddFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const patchNode = async (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => {
        if (!node.groupId) {
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<ToporBalancerNode>(`${ADMIN_GROUPS_URL}/${node.groupId}/nodes/${node.id}`, {
                body: JSON.stringify(patch),
                method: 'PATCH'
            })
            await refreshAdminData()
            await refreshGroupEditorData(node.groupId)
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.nodeUpdateFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const deleteNode = async (node: ToporBalancerNode) => {
        if (!node.groupId) {
            return
        }

        setIsLoading(true)

        try {
            await fetchAdminJson<{ deleted: true }>(`${ADMIN_GROUPS_URL}/${node.groupId}/nodes/${node.id}`, {
                method: 'DELETE'
            })
            await refreshAdminData()
            await refreshGroupEditorData(node.groupId)
            notifications.show({ color: 'green', message: texts.messages.nodeDeleted, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.nodeDeleteFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const runAssignmentAction = async (
        group: ToporBalancerGroup,
        path: string,
        confirmationText: string
    ) => {
        if (!window.confirm(confirmationText)) {
            return
        }

        setIsLoading(true)

        try {
            const summary = await fetchAdminJson<AssignmentActionSummary>(path, {
                body: JSON.stringify({ confirmed: true }),
                method: 'POST'
            })

            await refreshAdminData()
            await refreshGroupEditorData(group.id)
            notifications.show({
                color: summary?.errors.length ? 'yellow' : 'green',
                message: `Удалено: ${summary?.removed ?? 0}, переназначено: ${summary?.reassigned ?? 0}, пропущено: ${summary?.skipped ?? 0}`,
                title: 'Назначения обновлены'
            })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, 'Не удалось выполнить действие с назначениями'))
        } finally {
            setIsLoading(false)
        }
    }

    const resetGroupAssignments = (group: ToporBalancerGroup) =>
        runAssignmentAction(
            group,
            `${ADMIN_GROUPS_URL}/${group.id}/assignments/reset`,
            `Сбросить все назначения группы ${group.publicName}? Пользователи получат новые закрепления при следующем запросе подписки.`
        )

    const rebalanceGroupAssignments = (group: ToporBalancerGroup) =>
        runAssignmentAction(
            group,
            `${ADMIN_GROUPS_URL}/${group.id}/assignments/rebalance`,
            `Перераспределить текущие назначения группы ${group.publicName} по активным нодам? Ноды в выводе, отключенные и аварийные ноды не будут получать назначения.`
        )

    const migrateNodeAssignments = (node: ToporBalancerNode) => {
        if (!node.groupId || !selectedGroup) {
            return
        }

        runAssignmentAction(
            selectedGroup,
            `${ADMIN_GROUPS_URL}/${node.groupId}/nodes/${node.id}/assignments/migrate`,
            `Перенести назначения с ноды ${node.technicalHostName} на активные ноды этой группы?`
        )
    }

    const viewNodeAssignments = (node: ToporBalancerNode) => {
        setAssignmentNodeFilter(node.id)
        setGroupEditorTab('assignments')
    }

    const runApiDiscovery = async () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.discovery.selectGroup, title: texts.common.noGroup })
            return
        }

        const incompatibleSelectedHosts = discoveredHosts.filter(
            (host) =>
                selectedHosts.includes(normalizeTechnicalHostName(host.technicalHostName)) &&
                host.status === 'not_accessible_to_selected_squad'
        )

        if (incompatibleSelectedHosts.length > 0) {
            notifications.show({
                color: 'red',
                message: `Ноды недоступны для выбранной squad: ${incompatibleSelectedHosts.map((host) => host.technicalHostName).join(', ')}`,
                title: texts.discovery.conflict
            })
            return
        }

        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const topologyResponse = await fetchAdminJson<RemnawaveTopologySnapshot>(REMNAWAVE_TOPOLOGY_REFRESH_URL, {
                method: 'POST'
            })
            setTopology(topologyResponse)
            const response = await fetchAdminJson<DiscoveryResponse>(groupDiscoveryRefreshUrl(selectedGroup.id), {
                method: 'POST'
            })
            const items = response?.items ?? []
            setDiscoveredHosts(items)
            setDiscoveryImportStatuses({})
            setLastImportResult(null)
            setLastDiscoverySource('remnawave-api')
            setSelectedHosts(items.filter((item) => item.canAdd).map((item) => normalizeTechnicalHostName(item.technicalHostName)))
            if (response?.message) {
                notifications.show({ color: 'yellow', message: response.message, title: texts.messages.searchFailed })
            }
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.searchFailed))
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const runSubscriptionDiscovery = async () => {
        const normalizedShortUuid = shortUuid.trim()

        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.discovery.selectGroup, title: texts.common.noGroup })
            return
        }

        if (!normalizedShortUuid) {
            notifications.show({
                color: 'red',
                message: texts.messages.tokenRequired,
                title: texts.messages.missingData
            })
            return
        }

        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const response = await fetchAdminJson<DiscoveryResponse>(groupDiscoverySubscriptionUrl(selectedGroup.id), {
                body: JSON.stringify({ shortUuid: normalizedShortUuid }),
                method: 'POST'
            })
            const items = response?.items ?? []
            setDiscoveredHosts(items)
            setDiscoveryImportStatuses({})
            setLastImportResult(null)
            setLastDiscoverySource('subscription')
            setSelectedHosts(items.filter((item) => item.canAdd).map((item) => normalizeTechnicalHostName(item.technicalHostName)))
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.scanFailed))
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const toggleSelectedHost = (technicalHostName: string) => {
        const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName)

        setSelectedHosts((current) =>
            current.includes(normalizedTechnicalHostName)
                ? current.filter((item) => item !== normalizedTechnicalHostName)
                : [...current, normalizedTechnicalHostName]
        )
    }

    const openGroupEditor = (group: ToporBalancerGroup, tab = 'overview') => {
        if (group.id !== selectedGroupId) {
            setDiscoveredHosts([])
            setSelectedHosts([])
            setDiscoveryImportStatuses({})
            setLastImportResult(null)
            setLastDiscoverySource(null)
            setGroupRuntimeDiagnostics([])
        }

        setSelectedGroupId(group.id)
        setGroupNodes([])
        setGroupNodesGroupId(group.id)
        setGroupEditorTab(tab)
        setIsGroupEditorOpen(true)
        void refreshGroupEditorData(group.id)
    }

    const openAddNodesFlow = () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.messages.selectGroupFirst, title: texts.common.noGroup })
            return
        }

        setGroupEditorTab('nodes')
        setIsGroupEditorOpen(true)
        setGroupNodes([])
        setGroupNodesGroupId(selectedGroup.id)
        void refreshGroupEditorData(selectedGroup.id)

        if (discoveredHosts.length === 0) {
            void runApiDiscovery()
        }
    }

    const importSelectedHosts = async (technicalHostNames = selectedHosts) => {
        if (technicalHostNames.length === 0) {
            notifications.show({
                color: 'red',
                message: texts.discovery.selectAtLeastOne,
                title: texts.messages.missingData
            })
            return
        }

        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.discovery.selectGroup, title: texts.common.noGroup })
            return
        }

        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
            const result = await fetchAdminJson<ImportResult>(groupNodesImportUrl(selectedGroup.id), {
                body: JSON.stringify({
                    defaults: importDefaults,
                    mode: 'skip_conflicts',
                    technicalHostNames
                }),
                method: 'POST'
            })
            const createdNodes = safeArray<ToporBalancerNode>(result?.created)
            const alreadyInGroup = safeArray<{ technicalHostName: string }>(result?.alreadyInGroup)
            const inOtherGroup = safeArray<{ currentGroupName?: string; technicalHostName: string }>(result?.inOtherGroup)
            const errors = safeArray<{ reason: string; technicalHostName?: string }>(result?.errors)

            setDiscoveryImportStatuses((current) => {
                const next = { ...current }

                createdNodes.forEach((node) => {
                    next[normalizeTechnicalHostName(node.technicalHostName)] = { status: 'imported' }
                })
                alreadyInGroup.forEach((item) => {
                    next[normalizeTechnicalHostName(item.technicalHostName)] = {
                        message: texts.discovery.alreadyInGroup,
                        status: 'skipped'
                    }
                })
                inOtherGroup.forEach((item) => {
                    next[normalizeTechnicalHostName(item.technicalHostName)] = {
                        message: item.currentGroupName ?? texts.discovery.conflict,
                        status: 'conflict'
                    }
                })
                errors.forEach((error) => {
                    if (error.technicalHostName) {
                        next[normalizeTechnicalHostName(error.technicalHostName)] = {
                            message: error.reason,
                            status: 'error'
                        }
                    }
                })

                return next
            })
            setSelectedHosts((current) =>
                current.filter((technicalHostName) => {
                    const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName)

                    return (
                        !createdNodes.some((node) => normalizeTechnicalHostName(node.technicalHostName) === normalizedTechnicalHostName) &&
                        !alreadyInGroup.some((item) => normalizeTechnicalHostName(item.technicalHostName) === normalizedTechnicalHostName)
                    )
                })
            )
            await refreshAdminData()
            await refreshGroupEditorData(selectedGroup.id)

            if (lastDiscoverySource === 'subscription' && shortUuid.trim()) {
                await runSubscriptionDiscovery()
            } else {
                await runApiDiscovery()
            }

            setLastImportResult(result)

            notifications.show({
                color: inOtherGroup.length > 0 || errors.length > 0 ? 'yellow' : 'green',
                message: formatText(texts.discovery.importSummaryToast, {
                    conflicts: inOtherGroup.length,
                    created: createdNodes.length,
                    skipped: alreadyInGroup.length
                }),
                title: texts.discovery.importFinished
            })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.importFailed))
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const performDiscoveryImport = async () => {
        const selected = discoveredHosts.filter((host) =>
            selectedHosts.includes(normalizeTechnicalHostName(host.technicalHostName))
        )

        if (selected.length === 0) {
            return
        }

        const targetGroup = groups.find((group) => group.id === importTargetGroupId) ?? null

        if (importMode === 'existing' && !targetGroup) {
            notifications.show({ color: 'red', message: texts.discovery.targetGroupMissing, title: texts.common.noGroup })
            return
        }

        const incompatibleSelectedHosts = selected.filter(
            (host) => host.status === 'not_accessible_to_selected_squad'
        )

        if (incompatibleSelectedHosts.length > 0) {
            notifications.show({
                color: 'red',
                message: `Not accessible to selected squad: ${incompatibleSelectedHosts
                    .map((host) => normalizeTechnicalHostName(host.technicalHostName))
                    .join(', ')}`,
                title: 'Incompatible squad scope'
            })
            return
        }

        if (
            importMode === 'new' &&
            (!importGroupForm.publicHostCode.trim() ||
                !importGroupForm.publicName.trim() ||
                !importGroupForm.planCode.trim())
        ) {
            notifications.show({
                color: 'red',
                message: texts.messages.requiredGroupFields,
                title: texts.messages.missingData
            })
            return
        }

        if (
            importMode === 'new' &&
            importGroupForm.squadScope === 'specific_internal_squad' &&
            !importGroupForm.internalSquadUuid
        ) {
            notifications.show({
                color: 'red',
                message: 'Select an internal squad for this group.',
                title: texts.messages.missingData
            })
            return
        }

        setIsDiscoveryLoading(true)

        try {
            const result = await fetchAdminJson<ImportResult>(DISCOVERY_IMPORT_URL, {
                body: JSON.stringify({
                    ...(importMode === 'existing'
                        ? {
                              groupId: targetGroup?.id
                          }
                        : {
                              group: {
                                  internalSquadUuid:
                                      importGroupForm.squadScope === 'specific_internal_squad'
                                          ? importGroupForm.internalSquadUuid
                                          : undefined,
                                  locationCode: importGroupForm.locationCode.trim() || undefined,
                                  planCode: importGroupForm.planCode.trim(),
                                  publicHostCode: importGroupForm.publicHostCode.trim(),
                                  publicName: importGroupForm.publicName.trim(),
                                  squadScope: importGroupForm.squadScope
                              }
                          }),
                    nodes: selected.map((host) => ({
                        maxUsers: importDefaults.maxUsers,
                        status: importDefaults.status,
                        technicalHostName: normalizeTechnicalHostName(host.technicalHostName),
                        weight: importDefaults.weight
                    }))
                }),
                method: 'POST'
            })

            const importedNodes = [
                ...safeArray<ToporBalancerNode>(result?.created),
                ...safeArray<ToporBalancerNode>(result?.updated)
            ]
            const importedByName = new Map(
                importedNodes.map((node) => [normalizeTechnicalHostName(node.technicalHostName), node])
            )
            const skippedNames = new Set(
                safeArray<{ technicalHostName: string }>(result?.skipped).map((item) =>
                    normalizeTechnicalHostName(item.technicalHostName)
                )
            )
            const conflictNames = new Set(
                safeArray<{ technicalHostName: string }>(result?.conflicts).map((item) =>
                    normalizeTechnicalHostName(item.technicalHostName)
                )
            )
            const errorNames = new Set(
                safeArray<{ technicalHostName?: string }>(result?.errors)
                    .map((item) => normalizeTechnicalHostName(item.technicalHostName ?? ''))
                    .filter(Boolean)
            )

            setDiscoveredHosts((current) =>
                current.map((host) => {
                    const importedNode = importedByName.get(normalizeTechnicalHostName(host.technicalHostName))

                    return importedNode
                        ? {
                              ...host,
                              alreadyImported: true,
                              matchedNodeId: importedNode.id,
                              technicalHostName: normalizeTechnicalHostName(host.technicalHostName)
                          }
                        : host
                })
            )
            setDiscoveryImportStatuses((current) => {
                const next = { ...current }

                importedNodes.forEach((node) => {
                    next[normalizeTechnicalHostName(node.technicalHostName)] = {
                        status: 'imported'
                    }
                })
                skippedNames.forEach((technicalHostName) => {
                    next[technicalHostName] = {
                        status: 'skipped',
                        message: texts.discovery.alreadyInGroup
                    }
                })
                safeArray<ImportConflict>(result?.conflicts).forEach((conflict) => {
                    next[normalizeTechnicalHostName(conflict.technicalHostName)] = {
                        status: 'conflict',
                        message: `${conflict.existingPublicHostCode ?? '-'}:${conflict.existingPlanCode ?? '-'}`
                    }
                })
                safeArray<{ reason: string; technicalHostName?: string }>(result?.errors).forEach((error) => {
                    if (error.technicalHostName) {
                        next[normalizeTechnicalHostName(error.technicalHostName)] = {
                            status: 'error',
                            message: error.reason
                        }
                    }
                })

                return next
            })
            setSelectedHosts((current) =>
                current.filter((technicalHostName) => {
                    const normalizedTechnicalHostName = normalizeTechnicalHostName(technicalHostName)

                    return (
                        !importedByName.has(normalizedTechnicalHostName) &&
                        !skippedNames.has(normalizedTechnicalHostName)
                    )
                })
            )

            await refreshAdminData()
            setLastImportResult(result)
            notifications.show({
                color: conflictNames.size > 0 || errorNames.size > 0 ? 'yellow' : 'green',
                message: formatText(texts.discovery.importSummaryToast, { created: result?.created.length ?? 0, skipped: result?.skipped?.length ?? 0, conflicts: result?.conflicts?.length ?? 0 }),
                title: texts.discovery.importFinished
            })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.importFailed))
        } finally {
            setIsDiscoveryLoading(false)
        }
    }

    const runSubscriptionDiagnostics = async () => {
        const normalizedShortUuid = diagnosticsShortUuid.trim()

        if (!normalizedShortUuid) {
            notifications.show({
                color: 'red',
                message: texts.messages.tokenRequired,
                title: texts.messages.missingData
            })
            return
        }

        const userAgent =
            diagnosticsUserAgentPreset === 'custom'
                ? diagnosticsCustomUserAgent.trim()
                : diagnosticsUserAgentPreset

        setIsDiagnosticsLoading(true)
        setErrorMessage('')

        try {
            const result = await fetchAdminJson<SubscriptionDiagnosticsResult>(SUBSCRIPTION_DIAGNOSTICS_URL, {
                body: JSON.stringify({
                    shortUuid: normalizedShortUuid,
                    userAgent
                }),
                method: 'POST'
            })

            setSubscriptionDiagnostics(result)
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.subscriptionDiagnosticsFailed))
        } finally {
            setIsDiagnosticsLoading(false)
        }
    }

    const downloadSubscriptionDiagnostics = () => {
        if (!subscriptionDiagnostics) {
            return
        }

        const blob = new Blob([JSON.stringify(subscriptionDiagnostics, null, 2)], {
            type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')

        link.href = url
        link.download = `topor-subscription-diagnostics-${Date.now()}.json`
        link.click()
        URL.revokeObjectURL(url)
    }

    const statusItems = [
        { color: health?.enabled ? 'green' : 'gray', label: 'Балансировщик', value: health?.enabled ? texts.common.enabled : texts.common.disabled },
        { color: health?.databaseConnected ? 'green' : 'red', label: texts.common.database, value: health?.databaseConnected ? texts.common.connected : texts.common.disconnected },
        { color: 'cyan', label: texts.common.mode, value: getAssignmentModeLabel(health?.assignmentMode) },
        { color: 'blue', label: 'Группы', value: String(groups.length) },
        { color: 'violet', label: 'Ноды', value: String(nodes.length) },
        { color: 'gray', label: 'Последнее обновление', value: lastRefreshAt ? formatDate(lastRefreshAt.toISOString()) : '-' }
    ]

    return (
        <Page>
            <Modal
                opened={isCreateGroupModalOpen}
                onClose={() => setIsCreateGroupModalOpen(false)}
                size="lg"
                title="Создать группу"
            >
                <Stack gap="md">
                    <Group grow>
                        <TextInput
                            label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                            onChange={(event) => setGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                            value={groupForm.publicName}
                        />
                        <TextInput
                            error={getPublicHostCodeWarning(groupForm.publicHostCode)}
                            label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                            onChange={(event) => setGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                            value={groupForm.publicHostCode}
                        />
                    </Group>
                    <Group grow>
                        <TextInput
                            label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                            onChange={(event) => setGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                            value={groupForm.locationCode}
                        />
                        <TextInput
                            error={getPlanCodeWarning(groupForm.planCode)}
                            label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                            onChange={(event) => setGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                            value={groupForm.planCode}
                        />
                        <Select
                            data={strategyOptions}
                            label={<FieldLabel help={tooltips.strategy} label={texts.fields.strategy} />}
                            onChange={(value) =>
                                setGroupForm((current) => ({
                                    ...current,
                                    strategy: (value as ToporBalancerGroupStrategy | null) ?? 'least_loaded'
                                }))
                            }
                            value={groupForm.strategy}
                        />
                    </Group>
                    <StrategyLegend />
                    <Group justify="space-between">
                        <Switch
                            checked={groupForm.enabled}
                            label={texts.common.enabled}
                            onChange={(event) => setGroupForm((current) => ({ ...current, enabled: event.currentTarget.checked }))}
                        />
                        <Group gap="sm">
                            <Button onClick={() => setIsCreateGroupModalOpen(false)} variant="subtle">
                                {texts.actions.close}
                            </Button>
                            <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createGroup}>
                                Создать группу
                            </Button>
                        </Group>
                    </Group>
                </Stack>
            </Modal>

            <Modal
                opened={isGroupEditorOpen}
                onClose={() => setIsGroupEditorOpen(false)}
                padding="lg"
                size="92vw"
                title={selectedGroup ? `Группа: ${selectedGroup.publicName}` : 'Группа'}
            >
                {selectedGroup && (
                    <Tabs onChange={(value) => setGroupEditorTab(value ?? 'overview')} value={groupEditorTab}>
                        <Tabs.List>
                            <Tabs.Tab value="overview">Обзор</Tabs.Tab>
                            <Tabs.Tab value="nodes">Ноды</Tabs.Tab>
                            <Tabs.Tab value="assignments">Назначения</Tabs.Tab>
                            <Tabs.Tab value="diagnostics">Диагностика</Tabs.Tab>
                            <Tabs.Tab value="settings">Настройки</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel pt="md" value="overview">
                            <Stack gap="md">
                                <Group className={classes.groupOverviewGrid}>
                                    <Card className={classes.tableCard} p="md" radius="md">
                                        <Stack gap={8}>
                                            <Text c="dimmed" size="sm">Публичная группа</Text>
                                            <Title order={3}>{selectedGroup.publicName}</Title>
                                            <Group gap="xs">
                                                <Badge variant="light">{selectedGroup.publicHostCode}</Badge>
                                                <Badge variant="light">{selectedGroup.planCode}</Badge>
                                                {selectedGroup.locationCode && <Badge variant="light">{selectedGroup.locationCode}</Badge>}
                                            </Group>
                                        </Stack>
                                    </Card>
                                    <Card className={classes.tableCard} p="md" radius="md">
                                        <Stack gap={8}>
                                            <Text c="dimmed" size="sm">Состояние</Text>
                                            <Group gap="xs">
                                                <Badge color={selectedGroup.enabled ? 'green' : 'gray'} variant="light">
                                                    {selectedGroup.enabled ? texts.status.groupEnabled : texts.status.groupDisabled}
                                                </Badge>
                                                <Badge color="blue" variant="light">{selectedGroup.activeNodesCount}/{selectedGroup.nodesCount} активных нод</Badge>
                                                <Badge color="violet" variant="light">{selectedGroup.assignedUsers} назначений</Badge>
                                            </Group>
                                            <Text size="sm">Стратегия: {strategyOptions.find((item) => item.value === selectedGroup.strategy)?.label ?? selectedGroup.strategy}</Text>
                                        </Stack>
                                    </Card>
                                </Group>
                                <GroupProblemsPanel
                                    diagnostics={groupRuntimeDiagnostics}
                                    discoveredHosts={discoveredHosts}
                                    nodes={selectedGroupNodes}
                                    selectedGroup={selectedGroup}
                                />
                                <Group gap="sm">
                                    <Button leftSection={<IconPlus size={16} />} onClick={openAddNodesFlow}>
                                        Добавить ноды
                                    </Button>
                                    <Button onClick={() => setGroupEditorTab('diagnostics')} variant="light">
                                        Диагностика
                                    </Button>
                                    <Button onClick={() => setGroupEditorTab('settings')} variant="light">
                                        Настройки
                                    </Button>
                                    <Button color="red" onClick={() => patchGroup(selectedGroup, { enabled: !selectedGroup.enabled })} variant="subtle">
                                        {selectedGroup.enabled ? 'Отключить группу' : 'Включить группу'}
                                    </Button>
                                    <Button color="red" disabled={selectedGroup.nodesCount > 0} leftSection={<IconTrash size={16} />} onClick={() => deleteGroup(selectedGroup)} variant="subtle">
                                        Удалить группу
                                    </Button>
                                </Group>
                                {selectedGroupNodeCounterMismatch && (
                                    <Alert color="red" variant="light">
                                        Счетчик группы отличается от загруженного списка: в группе указано {selectedGroup.nodesCount}, загружено {selectedGroupNodes.length}.
                                    </Alert>
                                )}
                                <DiscoveredHostsTable
                                    assignments={selectedGroupAssignments}
                                    hosts={groupNodeDiscoveryRows}
                                    importedByTechnicalHostName={importedByTechnicalHostName}
                                    importStatuses={discoveryImportStatuses}
                                    importOneHost={(technicalHostName) => importSelectedHosts([technicalHostName])}
                                    patchNode={patchNode}
                                    removeNode={deleteNode}
                                    selectedGroup={selectedGroup}
                                    selectedHosts={selectedHosts}
                                    toggleSelectedHost={toggleSelectedHost}
                                />
                                {lastImportResult && <ImportResultSummary result={lastImportResult} />}
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="nodes">
                            <Stack gap="md">
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Stack gap="sm">
                                        <Group align="end" grow>
                                            <TextInput
                                                label={<FieldLabel help={tooltips.technicalHostName} label={texts.fields.technicalHostName} />}
                                                onChange={(event) => setNodeForm((current) => ({ ...current, technicalHostName: event.currentTarget.value }))}
                                                placeholder="FI-STD-01"
                                                value={nodeForm.technicalHostName}
                                            />
                                            <NumberInput
                                                label={<FieldLabel help={tooltips.weight} label={texts.fields.weight} />}
                                                min={0.0001}
                                                onChange={(value) => setNodeForm((current) => ({ ...current, weight: Number(value) || 1 }))}
                                                value={nodeForm.weight}
                                            />
                                            <NumberInput
                                                label={<FieldLabel help={tooltips.maxUsers} label={texts.fields.maxUsers} />}
                                                min={1}
                                                onChange={(value) => setNodeForm((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                                                value={nodeForm.maxUsers}
                                            />
                                            <Select
                                                data={statusOptions()}
                                                label={<FieldLabel help={tooltips.status} label={texts.fields.status} />}
                                                onChange={(value) =>
                                                    setNodeForm((current) => ({
                                                        ...current,
                                                        status: (value as ToporBalancerNodeStatus | null) ?? 'active'
                                                    }))
                                                }
                                                value={nodeForm.status}
                                            />
                                            <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createNode}>
                                                Добавить ноду
                                            </Button>
                                        </Group>
                                        <StatusLegend />
                                    </Stack>
                                </Card>
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Stack gap="md">
                                        <Group align="end" justify="space-between">
                                            <Group align="end">
                                                <Button leftSection={<IconRefresh size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery} variant="light">
                                                    Обновить из Remnawave
                                                </Button>
                                                <Checkbox
                                                    checked={showOnlyFreeDiscovery}
                                                    label="Показать только свободные"
                                                    onChange={(event) => setShowOnlyFreeDiscovery(event.currentTarget.checked)}
                                                />
                                                <TextInput
                                                    label="Поиск"
                                                    onChange={(event) => setNodeDiscoverySearch(event.currentTarget.value)}
                                                    placeholder="Техническая нода, хост, squad, profile"
                                                    value={nodeDiscoverySearch}
                                                />
                                                <Select
                                                    clearable
                                                    data={[
                                                        { label: 'Свободна', value: 'free' },
                                                        { label: 'В этой группе', value: 'in_this_group' },
                                                        { label: 'В другой группе', value: 'in_other_group' },
                                                        { label: 'Конфликт', value: 'conflict' },
                                                        ...Array.from(new Set(discoveredHosts.flatMap((host) => [
                                                            host.security,
                                                            host.type,
                                                            host.remnawaveProfileName,
                                                            ...(host.accessibleSquads?.map((squad) => squad.name) ?? [])
                                                        ].filter(Boolean) as string[]))).map((value) => ({ label: value, value }))
                                                    ]}
                                                    label="Фильтр"
                                                    onChange={setNodeDiscoveryFilter}
                                                    placeholder="Статус, squad, profile/inbound"
                                                    value={nodeDiscoveryFilter}
                                                />
                                            </Group>
                                            <Button disabled={selectedHosts.length === 0} leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={() => importSelectedHosts()}>
                                                Добавить выбранные в эту группу
                                            </Button>
                                        </Group>
                                        <Group align="end">
                                            <TextInput
                                                label="UUID тестовой подписки"
                                                onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                placeholder="Введите UUID"
                                                value={shortUuid}
                                            />
                                            <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                Проверить доступность по подписке
                                            </Button>
                                        </Group>
                                    </Stack>
                                </Card>
                                {selectedGroupNodeCounterMismatch && (
                                    <Alert color="red" variant="light">
                                        Счетчик группы отличается от загруженного списка: в группе указано {selectedGroup.nodesCount}, загружено {selectedGroupNodes.length}.
                                    </Alert>
                                )}
                                <DiscoveredHostsTable
                                    assignments={selectedGroupAssignments}
                                    hosts={groupNodeDiscoveryRows}
                                    importedByTechnicalHostName={importedByTechnicalHostName}
                                    importStatuses={discoveryImportStatuses}
                                    importOneHost={(technicalHostName) => importSelectedHosts([technicalHostName])}
                                    patchNode={patchNode}
                                    removeNode={deleteNode}
                                    selectedGroup={selectedGroup}
                                    selectedHosts={selectedHosts}
                                    toggleSelectedHost={toggleSelectedHost}
                                />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="assignments">
                            <Stack gap="md">
                                <AssignmentBehaviorInfo strategy={selectedGroup.strategy} />
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Group justify="space-between">
                                        <Stack gap={2}>
                                            <Title order={4}>Управление назначениями</Title>
                                            <Text c="dimmed" size="sm">Назначения — это закрепления пользователей Balancer. Это не общая нагрузка Remnawave.</Text>
                                        </Stack>
                                        <Group gap="xs">
                                            <Button color="red" loading={isLoading} onClick={() => resetGroupAssignments(selectedGroup)} variant="subtle">
                                                Сбросить назначения группы
                                            </Button>
                                            <Button loading={isLoading} onClick={() => rebalanceGroupAssignments(selectedGroup)} variant="light">
                                                Перераспределить назначения
                                            </Button>
                                        </Group>
                                    </Group>
                                </Card>
                                {assignmentNodeFilter && (
                                    <Alert color="blue" variant="light">
                                        Показаны назначения выбранной ноды. <Button onClick={() => setAssignmentNodeFilter(null)} size="xs" variant="subtle">Показать все</Button>
                                    </Alert>
                                )}
                                <AssignmentsTable
                                    assignments={
                                        assignmentNodeFilter
                                            ? selectedGroupAssignments.filter((assignment) => assignment.nodeId === assignmentNodeFilter)
                                            : selectedGroupAssignments
                                    }
                                    nodes={selectedGroupNodes}
                                />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="diagnostics">
                            <Stack gap="md">
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Stack gap="md">
                                        <Group justify="space-between">
                                            <Title order={4}>{texts.diagnostics.subscriptionTitle}</Title>
                                            {subscriptionDiagnostics && (
                                                <Badge color={getDiagnosticsOverallStatusColor(subscriptionDiagnostics.status)} variant="light">
                                                    {getDiagnosticsOverallStatusLabel(subscriptionDiagnostics.status)}
                                                </Badge>
                                            )}
                                        </Group>
                                        <Group align="end" grow>
                                            <TextInput
                                                label="UUID подписки"
                                                onChange={(event) => setDiagnosticsShortUuid(event.currentTarget.value)}
                                                placeholder="Введите UUID"
                                                value={diagnosticsShortUuid}
                                            />
                                            <Select
                                                data={DIAGNOSTICS_USER_AGENTS}
                                                label="Клиент"
                                                onChange={(value) => setDiagnosticsUserAgentPreset(value ?? 'v2RayTun/6.0')}
                                                value={diagnosticsUserAgentPreset}
                                            />
                                            {diagnosticsUserAgentPreset === 'custom' && (
                                                <TextInput
                                                    label="Свой клиент"
                                                    onChange={(event) => setDiagnosticsCustomUserAgent(event.currentTarget.value)}
                                                    value={diagnosticsCustomUserAgent}
                                                />
                                            )}
                                            <Button leftSection={<IconSearch size={16} />} loading={isDiagnosticsLoading} onClick={runSubscriptionDiagnostics}>
                                                Проверить
                                            </Button>
                                        </Group>
                                        {subscriptionDiagnostics && (
                                            <Stack gap="md">
                                                <Group gap="sm">
                                                    <Badge variant="light">Формат: {getSubscriptionFormatLabel(subscriptionDiagnostics.format)}</Badge>
                                                    <Badge variant="light">Входящих VLESS: {subscriptionDiagnostics.inputLinksCount}</Badge>
                                                    <Badge variant="light">Исходящих VLESS: {subscriptionDiagnostics.outputLinksCount}</Badge>
                                                </Group>
                                                <DiagnosticsSummary result={subscriptionDiagnostics} />
                                                <RecentSubscriptionTraces traces={subscriptionTraces} />
                                                <Group justify="flex-end">
                                                    <Button leftSection={<IconDownload size={16} />} onClick={downloadSubscriptionDiagnostics} variant="light">
                                                        Скачать отчёт
                                                    </Button>
                                                </Group>
                                            </Stack>
                                        )}
                                    </Stack>
                                </Card>
                                <GroupRecentDiagnosticsTable diagnostics={groupRuntimeDiagnostics} />
                                <Alert color={runtimeHealth?.fallbackConfigOk ? 'green' : 'red'} variant="light">
                                    {texts.diagnostics.runtimeConfig}: {runtimeHealth?.appConfigRoute ?? '/assets/.app-config-v2.json'}; источник: {runtimeHealth?.lastConfigSource ?? '-'}; ошибка: {runtimeHealth?.lastRuntimeConfigError ?? '-'}
                                </Alert>
                                <RequestsTable requests={requests} />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="settings">
                            <GroupSettingsForm group={selectedGroup} isLoading={isLoading} patchGroup={patchGroup} topology={topology} />
                        </Tabs.Panel>
                    </Tabs>
                )}
            </Modal>

            <Modal
                opened={isImportModalOpen}
                onClose={() => setIsImportModalOpen(false)}
                size="lg"
                title={texts.discovery.addModalTitle}
            >
                <Stack gap="md">
                    <Text c="dimmed" size="sm">
                        {formatText(texts.discovery.nodesSelected, { count: selectedHosts.length })}
                    </Text>
                    <Tabs onChange={(value) => setImportMode((value as ImportMode | null) ?? 'existing')} value={importMode}>
                        <Tabs.List>
                            <Tabs.Tab disabled={groups.length === 0} value="existing">
                                {texts.discovery.importTargetExisting}
                            </Tabs.Tab>
                            <Tabs.Tab value="new">{texts.discovery.importTargetNew}</Tabs.Tab>
                        </Tabs.List>

                        <Tabs.Panel pt="md" value="existing">
                            <Stack gap="md">
                                <Select
                                    data={groups.map((group) => ({
                                        label: `${group.publicName} · ${group.publicHostCode}:${group.planCode}`,
                                        value: group.id
                                    }))}
                                    label={texts.fields.group}
                                    onChange={setImportTargetGroupId}
                                    placeholder={texts.discovery.selectGroup}
                                    value={importTargetGroupId}
                                />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="new">
                            <Stack gap="md">
                                <Group grow>
                                    <TextInput
                                        label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                        value={importGroupForm.publicName}
                                    />
                                    <TextInput
                                        error={getPublicHostCodeWarning(importGroupForm.publicHostCode)}
                                        label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                        value={importGroupForm.publicHostCode}
                                    />
                                </Group>
                                <Group grow>
                                    <TextInput
                                        label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                        value={importGroupForm.locationCode}
                                    />
                                    <TextInput
                                        error={getPlanCodeWarning(importGroupForm.planCode)}
                                        label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                        value={importGroupForm.planCode}
                                    />
                                </Group>
                                <Group grow>
                                    <Select
                                        data={[
                                            { label: 'Any visible to user', value: 'any_visible_to_user' },
                                            { label: 'Specific internal squad', value: 'specific_internal_squad' }
                                        ]}
                                        label="Squad scope"
                                        onChange={(value) =>
                                            setImportGroupForm((current) => ({
                                                ...current,
                                                squadScope:
                                                    (value as ToporBalancerGroupSquadScope | null) ??
                                                    'any_visible_to_user'
                                            }))
                                        }
                                        value={importGroupForm.squadScope}
                                    />
                                    <Select
                                        data={(topology?.squads ?? []).map((squad) => ({
                                            label: squad.name,
                                            value: squad.uuid
                                        }))}
                                        disabled={importGroupForm.squadScope !== 'specific_internal_squad'}
                                        label="Internal squad"
                                        onChange={(value) =>
                                            setImportGroupForm((current) => ({
                                                ...current,
                                                internalSquadUuid: value ?? ''
                                            }))
                                        }
                                        placeholder="Select squad"
                                        value={importGroupForm.internalSquadUuid || null}
                                    />
                                </Group>
                            </Stack>
                        </Tabs.Panel>
                    </Tabs>

                    <Group grow>
                        <NumberInput
                            label={<FieldLabel help={tooltips.weight} label={texts.fields.weight} />}
                            min={0.0001}
                            onChange={(value) => setImportDefaults((current) => ({ ...current, weight: Number(value) || 1 }))}
                            value={importDefaults.weight}
                        />
                        <NumberInput
                            label={<FieldLabel help={tooltips.maxUsers} label={texts.fields.maxUsers} />}
                            min={1}
                            onChange={(value) => setImportDefaults((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                            value={importDefaults.maxUsers}
                        />
                        <Select
                            data={statusOptions()}
                            label={<FieldLabel help={tooltips.status} label={texts.fields.status} />}
                            onChange={(value) =>
                                setImportDefaults((current) => ({
                                    ...current,
                                    status: (value as ToporBalancerNodeStatus | null) ?? 'active'
                                }))
                            }
                            value={importDefaults.status}
                        />
                    </Group>
                    <StatusLegend />

                    {lastImportResult && <ImportResultSummary result={lastImportResult} />}

                    <Group justify="flex-end">
                        <Button onClick={() => setIsImportModalOpen(false)} variant="subtle">
                            {texts.actions.close}
                        </Button>
                        <Button leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={performDiscoveryImport}>
                            {texts.actions.import}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
            <Container maw={1320} px={{ base: 'md', sm: 'lg', md: 'xl' }} py="xl">
                <Stack gap="lg">
                    <Group justify="space-between">
                        <Group gap="sm">
                            <IconDatabase className={classes.titleIcon} size={28} />
                            <div>
                                <Title order={2}>{texts.title}</Title>
                                <Text c="dimmed" size="sm">
                                    {texts.subtitle}
                                </Text>
                            </div>
                        </Group>

                        {isLoggedIn && (
                            <Group gap="sm">
                                <Button leftSection={<IconRefresh size={16} />} loading={isLoading} onClick={refreshAdminData} variant="light">
                                    {texts.actions.refresh}
                                </Button>
                                <Button color="red" leftSection={<IconLogout size={16} />} onClick={logout} variant="subtle">
                                    {texts.actions.logout}
                                </Button>
                            </Group>
                        )}
                    </Group>

                    {errorMessage && (
                        <Alert color="red" icon={<IconAlertTriangle size={18} />} variant="light">
                            {errorMessage}
                        </Alert>
                    )}

                    {!isLoggedIn && (
                        <Card className={classes.loginCard} p="lg" radius="md">
                            <form onSubmit={saveToken}>
                                <Stack gap="md">
                                    <Group gap="sm">
                                        <IconShieldLock size={22} />
                                        <Title order={4}>{texts.forms.tokenTitle}</Title>
                                    </Group>
                                    <PasswordInput
                                        autoComplete="current-password"
                                        label={i18n[defaultLocale].admin.tokenLabel}
                                        onChange={(event) => setTokenInput(event.currentTarget.value)}
                                        placeholder={texts.forms.tokenPlaceholder}
                                        value={tokenInput}
                                    />
                                    <Button loading={isLoading} type="submit">
                                        {i18n[defaultLocale].admin.signIn}
                                    </Button>
                                </Stack>
                            </form>
                        </Card>
                    )}

                    {isLoggedIn && (
                        <>
                            <Card className={classes.statusBar} p="sm" radius="md">
                                <Group gap="sm" wrap="wrap">
                                    {statusItems.map((item) => (
                                        <Group className={classes.statusPill} gap={6} key={item.label} wrap="nowrap">
                                            <Text c="dimmed" size="xs">{item.label}</Text>
                                            <Text c={item.color} fw={700} size="sm">{item.value}</Text>
                                        </Group>
                                    ))}
                                </Group>
                            </Card>

                            <div className={classes.adminLayout}>
                                <Card className={classes.groupsPanel} p="md" radius="md">
                                    <Stack gap="md">
                                        <Group justify="space-between">
                                            <Title order={3}>Группы</Title>
                                            <Button leftSection={<IconPlus size={16} />} onClick={() => setIsCreateGroupModalOpen(true)} size="sm">
                                                Создать группу
                                            </Button>
                                        </Group>
                                        <TextInput
                                            leftSection={<IconSearch size={16} />}
                                            onChange={(event) => setGroupSearch(event.currentTarget.value)}
                                            placeholder="Поиск по группе, коду или тарифу"
                                            value={groupSearch}
                                        />
                                        <ScrollArea className={classes.groupListViewport}>
                                            <Stack gap="xs">
                                                {filteredGroups.length === 0 && (
                                                    <Stack align="center" className={classes.emptyState} gap={6}>
                                                        <Text fw={700}>{groups.length === 0 ? texts.groups.emptyTitle : 'Ничего не найдено'}</Text>
                                                        <Text c="dimmed" size="sm">{groups.length === 0 ? texts.groups.emptyText : 'Измените поиск или создайте новую группу.'}</Text>
                                                    </Stack>
                                                )}
                                                {filteredGroups.map((group) => (
                                                    <button
                                                        className={`${classes.groupListItem} ${selectedGroup?.id === group.id ? classes.groupListItemActive : ''}`}
                                                        key={group.id}
                                                        onClick={() => openGroupEditor(group)}
                                                        type="button"
                                                    >
                                                        <Group justify="space-between" wrap="nowrap">
                                                            <Stack gap={2}>
                                                                <Text fw={700} size="sm">{group.publicName}</Text>
                                                                <Text c="dimmed" size="xs">{group.publicHostCode} · {group.planCode}</Text>
                                                            </Stack>
                                                            <Badge color={group.enabled ? 'green' : 'gray'} size="sm" variant="light">
                                                                {group.enabled ? texts.status.groupEnabled : texts.status.groupDisabled}
                                                            </Badge>
                                                        </Group>
                                                        <Group gap="xs" mt={8}>
                                                            <Badge color="blue" size="xs" variant="light">{group.activeNodesCount}/{group.nodesCount} нод</Badge>
                                                            <Badge color="violet" size="xs" variant="light">{group.assignedUsers} назначений</Badge>
                                                        </Group>
                                                    </button>
                                                ))}
                                            </Stack>
                                        </ScrollArea>
                                    </Stack>
                                </Card>

                                <Card className={classes.groupContextPanel} p="md" radius="md">
                                    {selectedGroup ? (
                                        <Stack gap="md">
                                            <Group justify="space-between" wrap="nowrap">
                                                <div>
                                                    <Title order={3}>{selectedGroup.publicName}</Title>
                                                    <Text c="dimmed" size="sm">
                                                        {selectedGroup.publicHostCode} · {selectedGroup.planCode} · {selectedGroup.locationCode || '-'}
                                                    </Text>
                                                </div>
                                                <Badge color={selectedGroup.enabled ? 'green' : 'gray'} variant="light">
                                                    {selectedGroup.enabled ? texts.status.groupEnabled : texts.status.groupDisabled}
                                                </Badge>
                                            </Group>

                                            <Group gap="xs">
                                                <Badge color="blue" variant="light">{selectedGroup.activeNodesCount}/{selectedGroup.nodesCount} активных нод</Badge>
                                                <Badge color="violet" variant="light">{selectedGroup.assignedUsers} назначений</Badge>
                                                <Badge variant="light">{strategyOptions.find((item) => item.value === selectedGroup.strategy)?.label ?? selectedGroup.strategy}</Badge>
                                            </Group>

                                            <Group gap="sm">
                                                <Button leftSection={<IconPlus size={16} />} onClick={openAddNodesFlow}>
                                                    Добавить ноды
                                                </Button>
                                                <Button onClick={() => openGroupEditor(selectedGroup, 'diagnostics')} variant="light">
                                                    Диагностика
                                                </Button>
                                                <Button onClick={() => openGroupEditor(selectedGroup, 'settings')} variant="light">
                                                    Настройки
                                                </Button>
                                                <Button color="red" onClick={() => patchGroup(selectedGroup, { enabled: !selectedGroup.enabled })} variant="subtle">
                                                    {selectedGroup.enabled ? 'Отключить группу' : 'Включить группу'}
                                                </Button>
                                                <Button color="red" disabled={selectedGroup.nodesCount > 0} leftSection={<IconTrash size={16} />} onClick={() => deleteGroup(selectedGroup)} variant="subtle">
                                                    Удалить группу
                                                </Button>
                                            </Group>

                                            {selectedGroupNodeCounterMismatch && (
                                                <Alert color="red" variant="light">
                                                    Счетчик группы отличается от загруженного списка: в группе указано {selectedGroup.nodesCount}, загружено {selectedGroupNodes.length}.
                                                </Alert>
                                            )}
                                            <TechnicalNodesTable
                                                assignments={selectedGroupAssignments}
                                                deleteNode={deleteNode}
                                                discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                                migrateNodeAssignments={migrateNodeAssignments}
                                                nodes={selectedGroupNodes}
                                                patchNode={patchNode}
                                                viewNodeAssignments={viewNodeAssignments}
                                            />
                                        </Stack>
                                    ) : (
                                        <Stack align="center" className={classes.emptyState} gap="sm">
                                            <Title order={3}>Сначала создайте группу</Title>
                                            <Text c="dimmed" size="sm">После создания откроется редактор, где можно сразу добавить ноды.</Text>
                                            <Button leftSection={<IconPlus size={16} />} onClick={() => setIsCreateGroupModalOpen(true)}>
                                                Создать группу
                                            </Button>
                                        </Stack>
                                    )}
                                </Card>
                            </div>

                            <div className={classes.legacyAdmin}>
                            <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="md">
                                {statusItems.map((card) => (
                                    <Card className={classes.statusCard} key={card.label} p="lg" radius="md">
                                        <Stack gap={6}>
                                            <Text c="dimmed" size="sm">
                                                {card.label}
                                            </Text>
                                            <Text c={card.color} className={classes.statusValue} fw={700}>
                                                {card.value}
                                            </Text>
                                        </Stack>
                                    </Card>
                                ))}
                            </SimpleGrid>

                            <Tabs defaultValue="groups">
                                <Tabs.List>
                                    <Tabs.Tab value="groups">{texts.tabs.groups}</Tabs.Tab>
                                    <Tabs.Tab value="discovery">{texts.tabs.discovery}</Tabs.Tab>
                                    <Tabs.Tab value="diagnostics">{texts.tabs.diagnostics}</Tabs.Tab>
                                </Tabs.List>

                                <Tabs.Panel pt="md" value="groups">
                                    <Stack gap="md">
                                        <Group align="flex-start" grow>
                                            <Card className={classes.tableCard} p="lg" radius="md">
                                                <Stack gap="md">
                                                    <Group gap="xs">
                                                        <Title order={3}>{texts.forms.groupCreateTitle}</Title>
                                                        <Help label={tooltips.group} />
                                                    </Group>
                                                    <Group grow>
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                                                            value={groupForm.publicName}
                                                        />
                                                        <TextInput
                                                            error={getPublicHostCodeWarning(groupForm.publicHostCode)}
                                                            label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                                                            value={groupForm.publicHostCode}
                                                        />
                                                    </Group>
                                                    <Group grow>
                                                        <TextInput
                                                            label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                                                            value={groupForm.locationCode}
                                                        />
                                                        <TextInput
                                                            error={getPlanCodeWarning(groupForm.planCode)}
                                                            label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                                            value={groupForm.planCode}
                                                        />
                                                        <Switch
                                                            checked={groupForm.enabled}
                                                            label={texts.common.enabled}
                                                            onChange={(event) => setGroupForm((current) => ({ ...current, enabled: event.currentTarget.checked }))}
                                                        />
                                                    </Group>
                                                    <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createGroup}>
                                                        {texts.forms.groupCreateTitle}
                                                    </Button>
                                                </Stack>
                                            </Card>

                                            <Card className={classes.tableCard} p="lg" radius="md">
                                                <Stack gap="md">
                                                    <Title order={3}>{texts.forms.nodeCreateTitle}</Title>
                                                    <Text c="dimmed" size="sm">
                                                        {texts.forms.nodeCreateTarget} {selectedGroup?.publicName ?? '-'}
                                                    </Text>
                                                    <TextInput
                                                        label={<FieldLabel help={tooltips.technicalHostName} label={texts.fields.technicalHostName} />}
                                                        onChange={(event) => setNodeForm((current) => ({ ...current, technicalHostName: event.currentTarget.value }))}
                                                        placeholder="FI-STD-01"
                                                        value={nodeForm.technicalHostName}
                                                    />
                                                    <Group grow>
                                                        <NumberInput
                                                            label={<FieldLabel help={tooltips.weight} label={texts.fields.weight} />}
                                                            min={0.0001}
                                                            onChange={(value) => setNodeForm((current) => ({ ...current, weight: Number(value) || 1 }))}
                                                            value={nodeForm.weight}
                                                        />
                                                        <NumberInput
                                                            label={<FieldLabel help={tooltips.maxUsers} label={texts.fields.maxUsers} />}
                                                            min={1}
                                                            onChange={(value) => setNodeForm((current) => ({ ...current, maxUsers: Number(value) || 300 }))}
                                                            value={nodeForm.maxUsers}
                                                        />
                                                        <Select
                                                            data={statusOptions()}
                                                            label={<FieldLabel help={tooltips.status} label={texts.fields.status} />}
                                                            onChange={(value) =>
                                                                setNodeForm((current) => ({
                                                                    ...current,
                                                                    status: (value as ToporBalancerNodeStatus | null) ?? 'active'
                                                                }))
                                                            }
                                                            value={nodeForm.status}
                                                        />
                                                    </Group>
                                                    <Button leftSection={<IconPlus size={16} />} loading={isLoading} onClick={createNode} variant="light">
                                                        {texts.actions.addNode}
                                                    </Button>
                                                </Stack>
                                            </Card>
                                        </Group>

                                        <GroupsTable
                                            deleteGroup={deleteGroup}
                                            groups={groups}
                                            patchGroup={patchGroup}
                                            selectedGroupId={selectedGroup?.id ?? null}
                                            setSelectedGroupId={setSelectedGroupId}
                                        />

                                        {selectedGroupNodeCounterMismatch && selectedGroup && (
                                            <Alert color="red" variant="light">
                                                Счетчик группы отличается от загруженного списка: в группе указано {selectedGroup.nodesCount}, загружено {selectedGroupNodes.length}.
                                            </Alert>
                                        )}
                                        <TechnicalNodesTable
                                            assignments={selectedGroupAssignments}
                                            deleteNode={deleteNode}
                                            discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                            migrateNodeAssignments={migrateNodeAssignments}
                                            nodes={selectedGroupNodes}
                                            patchNode={patchNode}
                                            viewNodeAssignments={viewNodeAssignments}
                                        />
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="discovery">
                                    <Stack gap="md">
                                        <Card className={classes.tableCard} p="lg" radius="md">
                                            <Stack gap="md">
                                                <Group justify="space-between">
                                                    <div>
                                                        <Title order={3}>{texts.discovery.scanTitle}</Title>
                                                        <Text c="dimmed" size="sm">
                                                            {texts.discovery.importTarget} {selectedGroup?.publicName ?? '-'}
                                                        </Text>
                                                    </div>
                                                    <Badge color={selectedGroup ? 'green' : 'red'} variant="light">
                                                        {selectedGroup ? selectedGroup.publicHostCode : texts.common.noGroup}
                                                    </Badge>
                                                </Group>
                                                <Group align="end">
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery}>
                                                        {texts.actions.searchRemnawave}
                                                    </Button>
                                                    <TextInput
                                                        label="UUID тестовой подписки"
                                                        onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                        placeholder="Введите UUID"
                                                        value={shortUuid}
                                                    />
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                        {texts.actions.scanSubscription}
                                                    </Button>
                                                </Group>
                                            </Stack>
                                        </Card>

                                        <DiscoveredHostsTable
                                            hosts={discoveredHosts}
                                            importedByTechnicalHostName={importedByTechnicalHostName}
                                            importStatuses={discoveryImportStatuses}
                                            selectedGroup={selectedGroup}
                                            selectedHosts={selectedHosts}
                                            toggleSelectedHost={toggleSelectedHost}
                                        />

                                        <Group justify="flex-end">
                                            <Button disabled={selectedHosts.length === 0} leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={() => importSelectedHosts()}>
                                                {texts.actions.addToGroup}
                                            </Button>
                                        </Group>
                                    </Stack>
                                </Tabs.Panel>

                                <Tabs.Panel pt="md" value="diagnostics">
                                    <Stack gap="md">
                                        <Card className={classes.tableCard} p="lg" radius="md">
                                            <Stack gap="md">
                                                <Group justify="space-between">
                                                    <Title order={3}>{texts.diagnostics.subscriptionTitle}</Title>
                                                    {subscriptionDiagnostics && (
                                                        <Badge color={getDiagnosticsOverallStatusColor(subscriptionDiagnostics.status)} variant="light">
                                                            {getDiagnosticsOverallStatusLabel(subscriptionDiagnostics.status)}
                                                        </Badge>
                                                    )}
                                                </Group>
                                                <Group align="end" grow>
                                                    <TextInput
                                                        label="UUID подписки"
                                                        onChange={(event) => setDiagnosticsShortUuid(event.currentTarget.value)}
                                                        placeholder="Введите UUID"
                                                        value={diagnosticsShortUuid}
                                                    />
                                                    <Select
                                                        data={DIAGNOSTICS_USER_AGENTS}
                                                        label="Клиент"
                                                        onChange={(value) => setDiagnosticsUserAgentPreset(value ?? 'v2RayTun/6.0')}
                                                        value={diagnosticsUserAgentPreset}
                                                    />
                                                    {diagnosticsUserAgentPreset === 'custom' && (
                                                        <TextInput
                                                            label="Свой клиент"
                                                            onChange={(event) => setDiagnosticsCustomUserAgent(event.currentTarget.value)}
                                                            value={diagnosticsCustomUserAgent}
                                                        />
                                                    )}
                                                    <Button leftSection={<IconSearch size={16} />} loading={isDiagnosticsLoading} onClick={runSubscriptionDiagnostics}>
                                                        {texts.diagnostics.checkSubscription}
                                                    </Button>
                                                </Group>
                                                {subscriptionDiagnostics && (
                                                    <Stack gap="md">
                                                        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Status</Text>
                                                                <Badge color={getDiagnosticsOverallStatusColor(subscriptionDiagnostics.status)} variant="light">
                                                                    {getDiagnosticsOverallStatusLabel(subscriptionDiagnostics.status)}
                                                                </Badge>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Формат</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.format}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Входящих VLESS</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.inputLinksCount}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Исходящих VLESS</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.outputLinksCount}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Matched technical</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.matchedTechnicalLinks}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Rewritten</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.rewrittenLinksCount}</Text>
                                                            </Card>
                                                            <Card className={classes.statusCard} p="md" radius="md">
                                                                <Text c="dimmed" size="sm">Unchanged</Text>
                                                                <Text fw={700}>{subscriptionDiagnostics.unchangedLinksCount}</Text>
                                                            </Card>
                                                        </SimpleGrid>
                                                        <DiagnosticsSummary result={subscriptionDiagnostics} />
                                                        <RecentSubscriptionTraces traces={subscriptionTraces} />
                                                        <Group justify="flex-end">
                                                            <Button leftSection={<IconDownload size={16} />} onClick={downloadSubscriptionDiagnostics} variant="light">
                                                                Скачать отчёт
                                                            </Button>
                                                        </Group>
                                                    </Stack>
                                                )}
                                            </Stack>
                                        </Card>
                                        <Alert color={runtimeHealth?.fallbackConfigOk ? 'green' : 'red'} variant="light">
                                            {texts.diagnostics.runtimeConfig}: {runtimeHealth?.appConfigRoute ?? '/assets/.app-config-v2.json'}; {texts.diagnostics.source}: {runtimeHealth?.lastConfigSource ?? '-'}; {texts.diagnostics.error}: {runtimeHealth?.lastRuntimeConfigError ?? '-'}
                                        </Alert>
                                        <AssignmentsTable assignments={assignments} nodes={nodes} />
                                        <RequestsTable requests={requests} />
                                    </Stack>
                                </Tabs.Panel>
                            </Tabs>
                            </div>
                        </>
                    )}
                </Stack>
            </Container>
        </Page>
    )
}

function GroupSettingsForm({
    group,
    isLoading,
    patchGroup,
    topology
}: {
    group: ToporBalancerGroup
    isLoading: boolean
    patchGroup: (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => void
    topology: RemnawaveTopologySnapshot | null
}) {
    const [form, setForm] = useState({
        enabled: group.enabled,
        internalSquadUuid: group.internalSquadUuid ?? '',
        locationCode: group.locationCode ?? '',
        planCode: group.planCode,
        publicHostCode: group.publicHostCode,
        publicName: group.publicName,
        squadScope: group.squadScope ?? 'any_visible_to_user',
        strategy: group.strategy
    })

    useEffect(() => {
        setForm({
            enabled: group.enabled,
            internalSquadUuid: group.internalSquadUuid ?? '',
            locationCode: group.locationCode ?? '',
            planCode: group.planCode,
            publicHostCode: group.publicHostCode,
            publicName: group.publicName,
            squadScope: group.squadScope ?? 'any_visible_to_user',
            strategy: group.strategy
        })
    }, [group])

    return (
        <Card className={classes.tableCard} p="md" radius="md">
            <Stack gap="md">
                <Group grow>
                    <TextInput
                        label={<FieldLabel help={tooltips.publicName} label={texts.fields.publicName} />}
                        onChange={(event) => setForm((current) => ({ ...current, publicName: event.currentTarget.value }))}
                        value={form.publicName}
                    />
                    <TextInput
                        error={getPublicHostCodeWarning(form.publicHostCode)}
                        label={<FieldLabel help={tooltips.publicHostCode} label={texts.fields.publicHostCode} />}
                        onChange={(event) => setForm((current) => ({ ...current, publicHostCode: event.currentTarget.value }))}
                        value={form.publicHostCode}
                    />
                </Group>
                <Group grow>
                    <TextInput
                        label={<FieldLabel help={tooltips.locationCode} label={texts.fields.locationCode} />}
                        onChange={(event) => setForm((current) => ({ ...current, locationCode: event.currentTarget.value }))}
                        value={form.locationCode}
                    />
                    <TextInput
                        error={getPlanCodeWarning(form.planCode)}
                        label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                        onChange={(event) => setForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                        value={form.planCode}
                    />
                    <Select
                        data={strategyOptions}
                        label={<FieldLabel help={tooltips.strategy} label={texts.fields.strategy} />}
                        onChange={(value) =>
                            setForm((current) => ({
                                ...current,
                                strategy: (value as ToporBalancerGroupStrategy | null) ?? current.strategy
                            }))
                        }
                        value={form.strategy}
                    />
                </Group>
                <Group grow>
                    <Select
                        data={[
                            { label: 'Any squad visible to user', value: 'any_visible_to_user' },
                            { label: 'Specific internal squad', value: 'specific_internal_squad' }
                        ]}
                        label="Squad scope"
                        onChange={(value) =>
                            setForm((current) => ({
                                ...current,
                                squadScope: (value as ToporBalancerGroupSquadScope | null) ?? 'any_visible_to_user'
                            }))
                        }
                        value={form.squadScope}
                    />
                    {form.squadScope === 'specific_internal_squad' && (
                        <Select
                            data={(topology?.squads ?? []).map((squad) => ({
                                label: squad.name,
                                value: squad.uuid
                            }))}
                            label="Internal squad"
                            onChange={(value) => setForm((current) => ({ ...current, internalSquadUuid: value ?? '' }))}
                            placeholder="Refresh Remnawave topology first"
                            value={form.internalSquadUuid || null}
                        />
                    )}
                </Group>
                <StrategyLegend />
                <Group justify="space-between">
                    <Switch
                        checked={form.enabled}
                        label={texts.common.enabled}
                        onChange={(event) => setForm((current) => ({ ...current, enabled: event.currentTarget.checked }))}
                    />
                    <Button
                        loading={isLoading}
                        onClick={() =>
                            patchGroup(group, {
                                enabled: form.enabled,
                                locationCode: form.locationCode.trim() || undefined,
                                planCode: form.planCode.trim(),
                                publicHostCode: form.publicHostCode.trim(),
                                publicName: form.publicName.trim(),
                                squadScope: form.squadScope,
                                internalSquadUuid:
                                    form.squadScope === 'specific_internal_squad'
                                        ? form.internalSquadUuid
                                        : undefined,
                                strategy: form.strategy
                            })
                        }
                    >
                        Сохранить настройки
                    </Button>
                </Group>
            </Stack>
        </Card>
    )
}

function ImportResultSummary({ result }: { result: ImportResult }) {
    const conflicts = [...safeArray<ImportConflict>(result.conflicts), ...safeArray<GroupImportConflict>(result.inOtherGroup)]
    const skipped = [...safeArray<{ reason: string; technicalHostName: string }>(result.skipped), ...safeArray<{ nodeId?: string; technicalHostName: string }>(result.alreadyInGroup)]
    const errors = safeArray<{ reason: string; technicalHostName?: string }>(result.errors)
    const hasDetails = conflicts.length > 0 || errors.length > 0

    return (
        <Alert color={hasDetails ? 'yellow' : 'green'} variant="light">
            <Stack gap={6}>
                <Text fw={700}>{formatText(texts.discovery.importSummary, { created: result.created.length, skipped: skipped.length, conflicts: conflicts.length, errors: errors.length })}</Text>
                {conflicts.map((conflict) => (
                    <Text key={`conflict-${conflict.technicalHostName}`} size="sm">
                        {conflict.technicalHostName}: {texts.discovery.conflict}{' '}
                        {'reason' in conflict ? `${conflict.existingPublicHostCode ?? '-'}:${conflict.existingPlanCode ?? '-'}` : conflict.currentGroupName ?? '-'}
                    </Text>
                ))}
                {errors.map((error, index) => (
                    <Text key={`error-${error.technicalHostName ?? index}`} size="sm">
                        {error.technicalHostName ?? 'import'}: {error.reason}
                    </Text>
                ))}
            </Stack>
        </Alert>
    )
}

function DiagnosticsSummary({ result }: { result: SubscriptionDiagnosticsResult }) {
    const reasons = result.reasons ?? result.unchangedReasons
    const hasNoTechnicalHostNameMatches = result.totalVlessLinks > 0 && result.matchedTechnicalLinks === 0
    const hasNoActiveNodes = reasons.some((reason) => reason.reason === 'no_active_node')
    const hasSquadUnavailableNodes = reasons.some((reason) => reason.reason === 'no_accessible_candidates')
    const partiallyVisibleGroups = result.matchedGroups.filter(
        (group) =>
            group.groupNodesCount > 0 &&
            group.effectiveCandidateNodes.length < group.groupNodesCount
    )

    return (
        <Stack gap="md">
            <Alert color={getDiagnosticsOverallStatusColor(result.status)} variant="light">
                <Stack gap={4}>
                    <Text fw={700}>{getDiagnosticsOverallStatusLabel(result.status)}</Text>
                    {result.status === 'unsupported_app' && (
                        <Text size="sm">
                            Remnawave вернул заглушку неподдержанного приложения. Проверьте User-Agent клиента и настройки приложений в Subscription Page.
                        </Text>
                    )}
                    {hasNoTechnicalHostNameMatches && (
                        <Text size="sm">Не найдено совпадений technicalHostName</Text>
                    )}
                    {hasNoActiveNodes && <Text size="sm">Нет активных нод</Text>}
                    {hasSquadUnavailableNodes && (
                        <Text size="sm">Нода недоступна пользователю по squad</Text>
                    )}
                </Stack>
            </Alert>
            {(result.warnings.length > 0 || result.errors.length > 0) && (
                <Alert color={result.errors.length > 0 ? 'red' : 'yellow'} variant="light">
                    <Stack gap={4}>
                        {result.errors.map((error) => (
                            <Text key={`error-${error}`} size="sm">
                                {error}
                            </Text>
                        ))}
                        {result.warnings.map((warning) => (
                            <Text key={`warning-${warning}`} size="sm">
                                {warning}
                            </Text>
                        ))}
                    </Stack>
                </Alert>
            )}
            <Alert color="blue" variant="light">
                <Group gap="lg">
                    <Text size="sm">Squad пользователя: {result.userSquads.map((squad) => squad.name).join(', ') || '-'}</Text>
                    <Text size="sm">Доступных нод: {result.accessibleNodesCount}</Text>
                </Group>
            </Alert>
            {partiallyVisibleGroups.map((group) => (
                <Alert color="yellow" key={`${group.publicHostCode}:${group.planCode}:visibility`} variant="light">
                    <Stack gap={4}>
                        <Text fw={700} size="sm">
                            Для этой подписки доступна {group.effectiveCandidateNodes.length} из {group.groupNodesCount} нод группы.
                        </Text>
                        <Text className={classes.wrapCell} size="sm">
                            Группа {group.publicHostCode}:{group.planCode}. Видимые в подписке: {group.subscriptionCandidateNodes.join(', ') || '-'}.
                        </Text>
                        {group.excludedNodes.length > 0 && (
                            <Text className={classes.wrapCell} size="sm">
                                Исключены: {group.excludedNodes.map((node) => `${node.technicalHostName} (${node.reason})`).join(', ')}
                            </Text>
                        )}
                    </Stack>
                </Alert>
            ))}
            {result.unmatchedRemarks.length > 0 && (
                <Alert color="yellow" variant="light">
                    <Stack gap={4}>
                        <Text fw={700} size="sm">Исходные VLESS remarks без совпадения</Text>
                        <Text className={classes.wrapCell} size="sm">
                            {result.unmatchedRemarks.join(', ')}
                        </Text>
                        <Text size="sm">Добавьте эти значения как technicalHostName, если Balancer должен управлять этими ссылками.</Text>
                    </Stack>
                </Alert>
            )}
            {result.linkDiagnostics?.length > 0 && (
                <Card className={classes.tableCard} p={0} radius="md">
                    <ScrollArea>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Remark</Table.Th>
                                    <Table.Th>Нормализовано</Table.Th>
                                    <Table.Th>Длина</Table.Th>
                                    <Table.Th>Совпадение</Table.Th>
                                    <Table.Th>Настроенные technicalHostName</Table.Th>
                                    <Table.Th>Ближайшие кандидаты</Table.Th>
                                    <Table.Th>Причина</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {result.linkDiagnostics.map((diagnostic, index) => (
                                    <Table.Tr key={`${diagnostic.visibleRemark ?? 'empty'}-${index}`}>
                                        <Table.Td className={classes.wrapCell}>{diagnostic.visibleRemark ?? '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{diagnostic.normalizedRemark ?? '-'}</Table.Td>
                                        <Table.Td>{diagnostic.remarkLength}</Table.Td>
                                        <Table.Td>
                                            <Badge color={diagnostic.matchesTechnicalHostName ? 'green' : 'yellow'} variant="light">
                                                {diagnostic.matchesTechnicalHostName
                                                    ? diagnostic.matchedTechnicalHostName ?? 'Совпало'
                                                    : 'Не совпало'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td className={classes.wrapCell}>{diagnostic.configuredTechnicalHostNames.join(', ') || '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{diagnostic.closestTechnicalHostNameCandidates.join(', ') || '-'}</Table.Td>
                                        <Table.Td>{diagnostic.reason ? getDiagnosticsReasonLabel(diagnostic.reason) : diagnostic.normalizedComparisonResult}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Card>
            )}
            {reasons.length > 0 && (
                <Card className={classes.tableCard} p={0} radius="md">
                    <ScrollArea>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Причина</Table.Th>
                                    <Table.Th>Группа</Table.Th>
                                    <Table.Th>Remark</Table.Th>
                                    <Table.Th>Детали</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {reasons.map((reason, index) => (
                                    <Table.Tr key={`${reason.reason}-${reason.remark ?? index}`}>
                                        <Table.Td>
                                            <Badge color="yellow" variant="light">
                                                {getDiagnosticsReasonLabel(reason.reason)}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td>{reason.publicHostCode ? `${reason.publicHostCode}:${reason.planCode ?? '-'}` : '-'}</Table.Td>
                                        <Table.Td>{reason.remark ?? '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{reason.message}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Card>
            )}
            {result.matchedGroups.length > 0 && (
                <Card className={classes.tableCard} p={0} radius="md">
                    <ScrollArea>
                        <Table highlightOnHover>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Группа</Table.Th>
                                    <Table.Th>Публичное имя в выдаче</Table.Th>
                                    <Table.Th>Совпавшие remarks</Table.Th>
                                    <Table.Th>Squad пользователя</Table.Th>
                                    <Table.Th>Пул</Table.Th>
                                    <Table.Th>Кандидаты из подписки</Table.Th>
                                    <Table.Th>Эффективные кандидаты</Table.Th>
                                    <Table.Th>Исключены</Table.Th>
                                    <Table.Th>Выбранная нода</Table.Th>
                                    <Table.Th>Выходные remarks</Table.Th>
                                    <Table.Th>Перезапись</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {result.matchedGroups.map((group) => (
                                    <Table.Tr key={`${group.publicHostCode}:${group.planCode}`}>
                                        <Table.Td>{group.publicHostCode}:{group.planCode}</Table.Td>
                                        <Table.Td>
                                            <Badge color={group.outputContainsPublicName ? 'green' : 'yellow'} variant="light">
                                                {group.outputContainsPublicName ? group.publicName : 'Нет в выдаче'}
                                            </Badge>
                                        </Table.Td>
                                        <Table.Td className={classes.wrapCell}>{group.matchedRemarks.join(', ') || '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{group.userSquads.map((squad) => squad.name).join(', ') || '-'}</Table.Td>
                                        <Table.Td>{group.effectiveCandidateNodes.length}/{group.groupNodesCount}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{group.subscriptionCandidateNodes.join(', ') || '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{group.effectiveCandidateNodes.join(', ') || '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>
                                            {group.excludedNodes.map((node) => `${node.technicalHostName}: ${node.reason}`).join('; ') || '-'}
                                        </Table.Td>
                                        <Table.Td>{group.selectedTechnicalHostName ?? '-'}</Table.Td>
                                        <Table.Td className={classes.wrapCell}>{group.outputRemarks.join(', ') || '-'}</Table.Td>
                                        <Table.Td>{group.rewrittenLinksCount} / {group.unchangedLinksCount}</Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </ScrollArea>
                </Card>
            )}
            <Card className={classes.tableCard} p={0} radius="md">
                <ScrollArea>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Код группы</Table.Th>
                                <Table.Th>Тариф</Table.Th>
                                <Table.Th>Техническая нода</Table.Th>
                                <Table.Th>Статус</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {result.groups.map((group) => (
                                <Table.Tr key={`${group.publicHostCode}:${group.planCode}`}>
                                    <Table.Td>{group.publicHostCode}</Table.Td>
                                    <Table.Td>{group.planCode}</Table.Td>
                                    <Table.Td>{group.selectedTechnicalHostName ?? '-'}</Table.Td>
                                    <Table.Td>
                                        <Badge color={getDiagnosticsStatusColor(group.status)} variant="light">
                                            {getDiagnosticsStatusLabel(group.status)}
                                        </Badge>
                                    </Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Card>
            <Card className={classes.tableCard} p={0} radius="md">
                <ScrollArea>
                    <Table highlightOnHover>
                        <Table.Thead>
                            <Table.Tr>
                                <Table.Th>Техническая нода</Table.Th>
                                <Table.Th>Статус</Table.Th>
                                <Table.Th>Параметры</Table.Th>
                                <Table.Th>Предупреждения</Table.Th>
                            </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                            {result.vlessValidation.map((validation, index) => (
                                <Table.Tr key={`${validation.remark ?? 'link'}-${index}`}>
                                    <Table.Td>{validation.remark ?? '-'}</Table.Td>
                                    <Table.Td>
                                        <Badge color={validation.valid ? 'green' : 'red'} variant="light">
                                            {validation.valid ? texts.diagnostics.valid : texts.diagnostics.invalid}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td className={classes.wrapCell}>{validation.queryParamKeys.join(', ') || '-'}</Table.Td>
                                    <Table.Td className={classes.wrapCell}>{validation.warnings.join('; ') || '-'}</Table.Td>
                                </Table.Tr>
                            ))}
                        </Table.Tbody>
                    </Table>
                </ScrollArea>
            </Card>
        </Stack>
    )
}

function GroupsTable({
    deleteGroup,
    groups,
    patchGroup,
    selectedGroupId,
    setSelectedGroupId
}: {
    deleteGroup: (group: ToporBalancerGroup) => void
    groups: ToporBalancerGroup[]
    patchGroup: (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => void
    selectedGroupId: null | string
    setSelectedGroupId: (id: string) => void
}) {
    if (groups.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.groups.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.groups.emptyText}
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.groupsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicName}>Публичное название</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.publicHostCode}>Код группы</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.locationCode}>Локация</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.planCode}>Тариф</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>Стратегия</Table.Th>
                            <Table.Th>{texts.groups.activeNodes}</Table.Th>
                            <Table.Th>Назначения</Table.Th>
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>{texts.common.actions}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {groups.map((group) => (
                            <Table.Tr key={group.id}>
                                <Table.Td>{group.publicName}</Table.Td>
                                <Table.Td>{group.publicHostCode}</Table.Td>
                                <Table.Td>{group.locationCode || '-'}</Table.Td>
                                <Table.Td>{group.planCode}</Table.Td>
                                <Table.Td>{strategyOptions.find((item) => item.value === group.strategy)?.label ?? group.strategy}</Table.Td>
                                <Table.Td>
                                    {group.activeNodesCount}/{group.nodesCount}
                                </Table.Td>
                                <Table.Td>{group.assignedUsers}</Table.Td>
                                <Table.Td>
                                    <Badge color={group.enabled ? 'green' : 'gray'} variant="light">
                                        {group.enabled ? texts.status.groupEnabled : texts.status.groupDisabled}
                                    </Badge>
                                </Table.Td>
                                <Table.Td>
                                    <Group gap={6} wrap="nowrap">
                                        <Button
                                            disabled={selectedGroupId === group.id}
                                            onClick={() => setSelectedGroupId(group.id)}
                                            size="xs"
                                            variant="light"
                                        >
                                            {texts.actions.open}
                                        </Button>
                                        <Button
                                            onClick={() => patchGroup(group, { enabled: !group.enabled })}
                                            size="xs"
                                            variant="subtle"
                                        >
                                            {group.enabled ? texts.actions.disable : texts.actions.enable}
                                        </Button>
                                        <Button
                                            color="red"
                                            disabled={group.nodesCount > 0}
                                            leftSection={<IconTrash size={14} />}
                                            onClick={() => deleteGroup(group)}
                                            size="xs"
                                            variant="subtle"
                                        >
                                            {texts.actions.delete}
                                        </Button>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function RecentSubscriptionTraces({ traces }: { traces: SubscriptionTrace[] }) {
    if (traces.length === 0) {
        return null
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table highlightOnHover>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Время</Table.Th>
                            <Table.Th>shortUuid</Table.Th>
                            <Table.Th>User-Agent</Table.Th>
                            <Table.Th>Поток</Table.Th>
                            <Table.Th>Ссылок на входе</Table.Th>
                            <Table.Th>Совпало</Table.Th>
                            <Table.Th>Переписано</Table.Th>
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>Заглушка приложения</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {traces.map((trace) => (
                            <Table.Tr key={trace.id}>
                                <Table.Td>{formatDate(trace.request.timestamp)}</Table.Td>
                                <Table.Td>{trace.request.shortUuid}</Table.Td>
                                <Table.Td className={classes.wrapCell}>{trace.request.userAgent ?? '-'}</Table.Td>
                                <Table.Td>{getTraceFlowLabel(trace.request.flow)}</Table.Td>
                                <Table.Td>{trace.upstream.vlessLinksCount}</Table.Td>
                                <Table.Td>{trace.balancer.matchedTechnicalLinks}</Table.Td>
                                <Table.Td>{trace.balancer.rewrittenLinksCount}</Table.Td>
                                <Table.Td>{getRuntimeStatusLabel(trace.balancer.status)}</Table.Td>
                                <Table.Td>
                                    <Badge color={trace.upstream.unsupportedAppFallback || trace.balancer.unsupportedAppFallback ? 'red' : 'green'} variant="light">
                                        {trace.upstream.unsupportedAppFallback || trace.balancer.unsupportedAppFallback ? 'Да' : 'Нет'}
                                    </Badge>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function TechnicalNodesTable({
    assignments = [],
    deleteNode,
    discoveredByTechnicalHostName,
    migrateNodeAssignments,
    nodes,
    patchNode,
    viewNodeAssignments
}: {
    assignments?: ToporBalancerAssignment[]
    deleteNode: (node: ToporBalancerNode) => void
    discoveredByTechnicalHostName: Map<string, DiscoveredHost>
    migrateNodeAssignments?: (node: ToporBalancerNode) => void
    nodes: ToporBalancerNode[]
    patchNode: (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => void
    viewNodeAssignments?: (node: ToporBalancerNode) => void
}) {
    const totalAssignments = assignments.length

    if (nodes.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.nodes.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.nodes.emptyText}
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.nodesTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.technicalHostName}>Техническая нода</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.status}>Статус</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.weight}>Вес</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.maxUsers}>Лимит пользователей</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>Назначения</Table.Th>
                            <Table.Th>Импорт</Table.Th>
                            <Table.Th>{texts.common.actions}</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {nodes.map((node) => {
                            const discoveredHost = discoveredByTechnicalHostName.get(normalizeTechnicalHostName(node.technicalHostName))
                            const nodeAssignments = assignments.filter((assignment) => assignment.nodeId === node.id)
                            const nodePercent = totalAssignments > 0 ? Math.round((nodeAssignments.length / totalAssignments) * 100) : 0
                            const lastAssignment = nodeAssignments
                                .map((assignment) => assignment.updatedAt)
                                .filter(Boolean)
                                .sort()
                                .at(-1)

                            return (
                                <Table.Tr className={classes[`row-${node.status}`]} key={node.id}>
                                    <Table.Td>{node.technicalHostName}</Table.Td>
                                    <Table.Td>
                                        <Select
                                            data={statusOptions()}
                                            onChange={(value) =>
                                                patchNode(node, {
                                                    status: (value as ToporBalancerNodeStatus | null) ?? node.status
                                                })
                                            }
                                            size="xs"
                                            value={node.status}
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <NumberInput
                                            min={0.0001}
                                            onBlur={(event) => patchNode(node, { weight: Number(event.currentTarget.value) || 1 })}
                                            size="xs"
                                            value={node.weight}
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <NumberInput
                                            min={1}
                                            onBlur={(event) => patchNode(node, { maxUsers: Number(event.currentTarget.value) || 300 })}
                                            size="xs"
                                            value={node.maxUsers}
                                        />
                                    </Table.Td>
                                    <Table.Td>
                                        <Stack gap={2}>
                                            <Text size="sm">{node.assignedUsers} ({nodePercent}%)</Text>
                                            <Text c="dimmed" size="xs">Последнее: {formatDate(lastAssignment)}</Text>
                                            {viewNodeAssignments && (
                                                <Button onClick={() => viewNodeAssignments(node)} size="compact-xs" variant="subtle">
                                                    Посмотреть назначения
                                                </Button>
                                            )}
                                        </Stack>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge color={discoveredHost ? 'green' : 'gray'} variant="light">
                                            {discoveredHost ? 'Импортировано' : 'Не импортировано'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <Group gap={6} wrap="nowrap">
                                            <Button disabled={node.status === 'active'} onClick={() => patchNode(node, { status: 'active' })} size="xs" variant="light">
                                                {texts.actions.enable}
                                            </Button>
                                            <Button disabled={node.status === 'draining'} onClick={() => patchNode(node, { status: 'draining' })} size="xs" variant="light">
                                                {texts.actions.startDraining}
                                            </Button>
                                            <Button color="red" disabled={node.status === 'disabled'} onClick={() => patchNode(node, { status: 'disabled' })} size="xs" variant="subtle">
                                                {texts.actions.disable}
                                            </Button>
                                            {migrateNodeAssignments && (
                                                <Button disabled={node.assignedUsers === 0} onClick={() => migrateNodeAssignments(node)} size="xs" variant="light">
                                                    Перенести назначения
                                                </Button>
                                            )}
                                            <Button color="red" disabled={node.assignedUsers > 0} onClick={() => deleteNode(node)} size="xs" variant="subtle">
                                                {texts.actions.delete}
                                            </Button>
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function getDiscoveredHostStatusBadge({
    host,
    importedNode,
    importStatus,
    isImportedIntoSelectedGroup
}: {
    host: DiscoveredHost
    importedNode?: ToporBalancerNode
    importStatus?: DiscoveryImportStatusState
    isImportedIntoSelectedGroup: boolean
}) {
    if (importStatus?.status === 'imported') {
        return { color: 'green', label: texts.discovery.imported, tooltip: texts.tooltips.imported }
    }

    if (importStatus?.status === 'skipped') {
        return { color: 'blue', label: texts.discovery.alreadyInGroup, tooltip: importStatus.message }
    }

    if (importStatus?.status === 'conflict') {
        return { color: 'red', label: texts.discovery.conflict, tooltip: importStatus.message }
    }

    if (importStatus?.status === 'error') {
        return { color: 'red', label: texts.discovery.error, tooltip: importStatus.message }
    }

    if (host.status === 'free') {
        return { color: 'gray', label: 'Свободна', tooltip: texts.tooltips.discovered }
    }

    if (host.status === 'not_accessible_to_selected_squad') {
        return { color: 'red', label: 'Конфликт', tooltip: 'Хост Remnawave недоступен в squad выбранной группы.' }
    }

    if (host.status === 'in_this_group') {
        return { color: 'green', label: 'В этой группе', tooltip: host.currentGroupName ?? texts.tooltips.imported }
    }

    if (host.status === 'in_other_group') {
        return { color: 'yellow', label: 'В другой группе', tooltip: host.currentGroupName ?? undefined }
    }

    if (host.status === 'conflict') {
        return { color: 'red', label: texts.discovery.conflict, tooltip: host.currentGroupName ?? undefined }
    }

    if (isImportedIntoSelectedGroup) {
        return { color: 'green', label: texts.discovery.imported, tooltip: texts.tooltips.imported }
    }

    if (importedNode) {
        return {
            color: 'yellow',
            label: texts.discovery.conflict,
            tooltip: `${importedNode.publicHostCode}:${importedNode.planCode}`
        }
    }

    return { color: 'gray', label: 'Свободна', tooltip: texts.tooltips.discovered }
}

function DiscoveredHostsTable({
    assignments = [],
    hosts,
    importOneHost,
    importedByTechnicalHostName,
    importStatuses,
    patchNode,
    removeNode,
    selectedGroup,
    selectedHosts,
    toggleSelectedHost
}: {
    assignments?: ToporBalancerAssignment[]
    hosts: DiscoveredHost[]
    importOneHost?: (technicalHostName: string) => void
    importedByTechnicalHostName: Map<string, ToporBalancerNode>
    importStatuses: Record<string, DiscoveryImportStatusState>
    patchNode?: (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => void
    removeNode?: (node: ToporBalancerNode) => void
    selectedGroup: null | ToporBalancerGroup
    selectedHosts: string[]
    toggleSelectedHost: (technicalHostName: string) => void
}) {
    if (hosts.length === 0) {
        return (
            <Card className={classes.tableCard} p="lg" radius="md">
                <Stack align="center" className={classes.emptyState} gap={6}>
                    <Text fw={700}>{texts.discovery.emptyTitle}</Text>
                    <Text c="dimmed" size="sm">
                        {texts.discovery.emptyText}
                    </Text>
                </Stack>
            </Card>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.discoveryTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th />
                            <Table.Th>
                                <HeaderWithHelp help={tooltips.technicalHostName}>Техническая нода</HeaderWithHelp>
                            </Table.Th>
                            <Table.Th>Участие</Table.Th>
                            <Table.Th>Текущая группа</Table.Th>
                            <Table.Th>Squad</Table.Th>
                            <Table.Th>Inbound / profile</Table.Th>
                            <Table.Th>Хост Remnawave</Table.Th>
                            <Table.Th>Нода Remnawave</Table.Th>
                            <Table.Th>Хост</Table.Th>
                            <Table.Th>Порт</Table.Th>
                            <Table.Th>Протокол</Table.Th>
                            <Table.Th>Защита</Table.Th>
                            <Table.Th>Транспорт</Table.Th>
                            <Table.Th>SNI</Table.Th>
                            <Table.Th>Поток</Table.Th>
                            <Table.Th>Секреты</Table.Th>
                            <Table.Th>Статус Balancer</Table.Th>
                            <Table.Th>Назначения</Table.Th>
                            <Table.Th>Действия</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {hosts.map((host) => {
                            const technicalHostName = normalizeTechnicalHostName(host.technicalHostName)
                            const importedNode = importedByTechnicalHostName.get(technicalHostName)
                            const importStatus = importStatuses[technicalHostName]
                            const isImportedIntoSelectedGroup = Boolean(
                                selectedGroup &&
                                    importedNode &&
                                    importedNode.groupId === selectedGroup.id
                            )
                            const statusBadge = getDiscoveredHostStatusBadge({
                                host,
                                importStatus,
                                importedNode,
                                isImportedIntoSelectedGroup
                            })
                            const canAdd = host.canAdd ?? (!isImportedIntoSelectedGroup && !importedNode)
                            const nodeAssignments = importedNode ? assignments.filter((assignment) => assignment.nodeId === importedNode.id) : []
                            const membershipStatus = host.membershipStatus ?? host.status
                            const currentGroupName = membershipStatus === 'in_other_group' || membershipStatus === 'conflict'
                                ? host.currentGroupName ?? importedNode?.publicName ?? '-'
                                : '-'

                            return (
                                <Table.Tr key={technicalHostName}>
                                    <Table.Td>
                                        <Checkbox
                                            checked={selectedHosts.includes(technicalHostName)}
                                            disabled={!canAdd}
                                            onChange={() => toggleSelectedHost(technicalHostName)}
                                        />
                                    </Table.Td>
                                    <Table.Td>{technicalHostName}</Table.Td>
                                    <Table.Td>
                                        <Tooltip disabled={!statusBadge.tooltip} label={statusBadge.tooltip} withArrow>
                                            <Badge color={statusBadge.color} variant="light">
                                                {statusBadge.label}
                                            </Badge>
                                        </Tooltip>
                                    </Table.Td>
                                    <Table.Td className={classes.wrapCell}>{currentGroupName}</Table.Td>
                                    <Table.Td className={classes.wrapCell}>
                                        {host.accessibleSquads?.map((squad) => squad.name).join(', ') || '-'}
                                    </Table.Td>
                                    <Table.Td className={classes.wrapCell}>
                                        {[host.remnawaveInboundName, host.remnawaveProfileName].filter(Boolean).join(' / ') || '-'}
                                    </Table.Td>
                                    <Table.Td className={classes.wrapCell}>{host.rawRemark ?? '-'}</Table.Td>
                                    <Table.Td className={classes.wrapCell}>{host.remnawaveNodeName ?? '-'}</Table.Td>
                                    <Table.Td>{host.host ?? '-'}</Table.Td>
                                    <Table.Td>{host.port ?? '-'}</Table.Td>
                                    <Table.Td>{host.protocol ?? '-'}</Table.Td>
                                    <Table.Td>{host.security ?? '-'}</Table.Td>
                                    <Table.Td>{host.type ?? '-'}</Table.Td>
                                    <Table.Td>{host.sni ?? '-'}</Table.Td>
                                    <Table.Td>{host.flow ?? '-'}</Table.Td>
                                    <Table.Td>{[maskSecret(host.pbk), maskSecret(host.sid)].filter((value) => value !== '-').join(' / ') || '-'}</Table.Td>
                                    <Table.Td>{importedNode ? statusLabels[importedNode.status] : '-'}</Table.Td>
                                    <Table.Td>{importedNode ? `${importedNode.assignedUsers} (${nodeAssignments.length})` : '-'}</Table.Td>
                                    <Table.Td>
                                        <Group gap={6} wrap="nowrap">
                                            {canAdd && (
                                                <Button loading={false} onClick={() => importOneHost?.(technicalHostName)} size="xs" variant="light">
                                                    Добавить в группу
                                                </Button>
                                            )}
                                            {importedNode && importedNode.groupId === selectedGroup?.id && (
                                                <>
                                                    <Button disabled={importedNode.status === 'active'} onClick={() => patchNode?.(importedNode, { status: 'active' })} size="xs" variant="light">
                                                        Включить
                                                    </Button>
                                                    <Button disabled={importedNode.status === 'draining'} onClick={() => patchNode?.(importedNode, { status: 'draining' })} size="xs" variant="light">
                                                        Выводить
                                                    </Button>
                                                    <Button color="red" disabled={importedNode.status === 'disabled'} onClick={() => patchNode?.(importedNode, { status: 'disabled' })} size="xs" variant="subtle">
                                                        Отключить
                                                    </Button>
                                                    <Button color="red" disabled={importedNode.status === 'dead'} onClick={() => patchNode?.(importedNode, { status: 'dead' })} size="xs" variant="subtle">
                                                        Авария
                                                    </Button>
                                                    <Button color="red" disabled={importedNode.assignedUsers > 0} onClick={() => removeNode?.(importedNode)} size="xs" variant="subtle">
                                                        Убрать из группы
                                                    </Button>
                                                </>
                                            )}
                                            {importedNode && importedNode.groupId === selectedGroup?.id && (
                                                <>
                                                <NumberInput
                                                    aria-label="Изменить вес"
                                                    min={0.0001}
                                                    onBlur={(event) => patchNode?.(importedNode, { weight: Number(event.currentTarget.value) || 1 })}
                                                    size="xs"
                                                    value={importedNode.weight}
                                                    w={80}
                                                />
                                                <NumberInput
                                                    aria-label="Изменить лимит пользователей"
                                                    min={1}
                                                    onBlur={(event) => patchNode?.(importedNode, { maxUsers: Number(event.currentTarget.value) || 300 })}
                                                    size="xs"
                                                    value={importedNode.maxUsers}
                                                    w={90}
                                                />
                                                </>
                                            )}
                                        </Group>
                                    </Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function GroupProblemsPanel({
    diagnostics,
    discoveredHosts,
    nodes,
    selectedGroup
}: {
    diagnostics: GroupRuntimeDiagnostic[]
    discoveredHosts: DiscoveredHost[]
    nodes: ToporBalancerNode[]
    selectedGroup: ToporBalancerGroup
}) {
    const latest = diagnostics[0]
    const latestGroup = latest?.groupDiagnostic
    const discoveredByName = new Map(discoveredHosts.map((host) => [normalizeTechnicalHostName(host.technicalHostName), host]))
    const squadKeys = new Set(
        nodes.flatMap((node) => discoveredByName.get(normalizeTechnicalHostName(node.technicalHostName))?.accessibleSquads?.map((squad) => squad.uuid) ?? [])
    )
    const problems = [
        nodes.every((node) => node.status !== 'active') ? 'Нет активных нод.' : '',
        squadKeys.size > 1 ? 'В группе есть ноды из разных squad.' : '',
        latestGroup?.excludedNodes.some((node) => node.reason === 'not_accessible_to_group_squad')
            ? 'В группе есть нода из другой squad.'
            : '',
        latest?.warnings.some((warning) => warning.includes('technicalHostName')) ||
        latestGroup?.warnings.some((warning) => warning.includes('technicalHostName'))
            ? 'Есть несовпадение technicalHostName.'
            : '',
        latestGroup
            ? `Для последней проверенной подписки доступно ${latestGroup.effectiveCandidateNodes.length} из ${latestGroup.subscriptionCandidateNodes.length} нод группы.`
            : '',
        latestGroup?.previousAssignedNodeStatus === 'disabled' || latestGroup?.previousAssignedNodeStatus === 'dead'
            ? `Текущее назначение пользователя указывает на ${latestGroup.previousAssignedNodeStatus} ноду: ${latestGroup.previousAssignedNode}.`
            : '',
        latest?.status === 'unsupported_app' ? 'Обнаружена заглушка неподдержанного приложения.' : '',
        latest?.status === 'passed_through' ? 'Подписка прошла без перезаписи ссылок.' : '',
        latest?.status === 'no_effective_candidates' ? 'Нет эффективных кандидатов.' : '',
        latest?.status === 'no_active_candidates' ? 'Нет активных кандидатов.' : '',
        latest?.status === 'failed_open' || latestGroup?.failOpenReason ? 'Использован режим отдачи исходной подписки при ошибке.' : '',
        ...(latestGroup?.excludedNodes.map((node) => `${node.technicalHostName}: ${node.message}`) ?? []),
        ...(latestGroup?.warnings ?? []),
        ...(latest?.warnings ?? [])
    ].filter(Boolean)

    if (problems.length === 0) {
        return (
            <Alert color="green" variant="light">
                Проблемы группы не обнаружены.
            </Alert>
        )
    }

    return (
        <Alert color="yellow" title="Проблемы группы" variant="light">
            <Stack gap={4}>
                {Array.from(new Set(problems)).map((problem) => (
                    <Text key={problem} size="sm">{problem}</Text>
                ))}
            </Stack>
        </Alert>
    )
}

function GroupRecentDiagnosticsTable({ diagnostics }: { diagnostics: GroupRuntimeDiagnostic[] }) {
    if (diagnostics.length === 0) {
        return (
            <Alert color="gray" variant="light">
                Последних runtime diagnostics для этой группы пока нет. Обновите подписку в клиенте и откройте группу снова.
            </Alert>
        )
    }

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Время</Table.Th>
                            <Table.Th>shortUuid</Table.Th>
                            <Table.Th>User-Agent</Table.Th>
                            <Table.Th>Всего ссылок</Table.Th>
                            <Table.Th>Совпало</Table.Th>
                            <Table.Th>Переписано</Table.Th>
                            <Table.Th>Выбранная нода</Table.Th>
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>Предупреждения</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {diagnostics.map((diagnostic, index) => (
                            <Table.Tr key={`${diagnostic.time ?? index}-${diagnostic.shortUuid}`}>
                                <Table.Td>{formatDate(diagnostic.time)}</Table.Td>
                                <Table.Td>{diagnostic.shortUuid}</Table.Td>
                                <Table.Td className={classes.wrapCell}>{diagnostic.userAgent ?? '-'}</Table.Td>
                                <Table.Td>{diagnostic.totalLinks ?? '-'}</Table.Td>
                                <Table.Td>{diagnostic.matchedLinks ?? '-'}</Table.Td>
                                <Table.Td>{diagnostic.rewrittenLinks ?? '-'}</Table.Td>
                                <Table.Td>{diagnostic.selectedNode ?? '-'}</Table.Td>
                                <Table.Td>{getRuntimeStatusLabel(diagnostic.status)}</Table.Td>
                                <Table.Td className={classes.wrapCell}>{diagnostic.warnings.join('; ') || '-'}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function AssignmentBehaviorInfo({ strategy }: { strategy: ToporBalancerGroupStrategy }) {
    return (
        <Alert color="blue" variant="light">
            <Stack gap={4}>
                <Text size="sm">Назначения — это закрепления пользователей Balancer. Это не общая нагрузка Remnawave.</Text>
                {strategy === 'least_loaded' && (
                    <Text size="sm">
                        Стратегия применяется только к новым назначениям. Уже закреплённые пользователи остаются на своих нодах, пока нода активна или выводится.
                    </Text>
                )}
            </Stack>
        </Alert>
    )
}

function AssignmentsTable({ assignments, nodes }: { assignments: ToporBalancerAssignment[]; nodes: ToporBalancerNode[] }) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))
    const sortedAssignments = [...assignments].sort((left, right) => {
        const leftNode = left.technicalHostName || nodeById.get(left.nodeId)?.technicalHostName || ''
        const rightNode = right.technicalHostName || nodeById.get(right.nodeId)?.technicalHostName || ''

        return leftNode.localeCompare(rightNode, 'ru') || left.shortUuid.localeCompare(right.shortUuid, 'ru')
    })

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.assignmentsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Нода Balancer</Table.Th>
                            <Table.Th>UUID подписки</Table.Th>
                            <Table.Th>Код группы</Table.Th>
                            <Table.Th>Тариф</Table.Th>
                            <Table.Th>Выбранная нода</Table.Th>
                            <Table.Th>Создано</Table.Th>
                            <Table.Th>Обновлено</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {sortedAssignments.map((assignment) => {
                            const selectedNode = assignment.technicalHostName || nodeById.get(assignment.nodeId)?.technicalHostName || '-'

                            return (
                                <Table.Tr key={assignment.id}>
                                    <Table.Td>{selectedNode}</Table.Td>
                                    <Table.Td>{maskShort(assignment.shortUuid)}</Table.Td>
                                    <Table.Td>{assignment.publicHostCode}</Table.Td>
                                    <Table.Td>{assignment.planCode}</Table.Td>
                                    <Table.Td>{selectedNode}</Table.Td>
                                    <Table.Td>{formatDate(assignment.createdAt)}</Table.Td>
                                    <Table.Td>{formatDate(assignment.updatedAt)}</Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function RequestsTable({ requests }: { requests: ToporBalancerRequest[] }) {
    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.requestsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Создано</Table.Th>
                            <Table.Th>UUID подписки</Table.Th>
                            <Table.Th>Формат</Table.Th>
                            <Table.Th>Входящих ссылок</Table.Th>
                            <Table.Th>Исходящих ссылок</Table.Th>
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>Ошибка</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {requests.map((request) => (
                            <Table.Tr key={request.id}>
                                <Table.Td>{formatDate(request.createdAt)}</Table.Td>
                                <Table.Td>{maskShort(request.shortUuid)}</Table.Td>
                                <Table.Td>{request.responseFormat || '-'}</Table.Td>
                                <Table.Td>{request.inputLinksCount ?? '-'}</Table.Td>
                                <Table.Td>{request.outputLinksCount ?? '-'}</Table.Td>
                                <Table.Td>{request.status || '-'}</Table.Td>
                                <Table.Td className={classes.wrapCell}>{redactSensitiveText(request.errorMessage)}</Table.Td>
                            </Table.Tr>
                        ))}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}
