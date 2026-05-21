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
const DISCOVERY_API_URL = '/api/topor-balancer/discovery/remnawave'
const DISCOVERY_SUBSCRIPTION_URL = '/api/topor-balancer/discovery/subscription'
const DISCOVERY_IMPORT_URL = '/api/topor-balancer/discovery/import'
const groupDiscoveryApiUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/remnawave`
const groupDiscoveryRefreshUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/refresh`
const groupDiscoverySubscriptionUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/discovery/subscription`
const groupNodesImportUrl = (groupId: string) => `/api/topor-balancer/groups/${encodeURIComponent(groupId)}/nodes/import`
const SUBSCRIPTION_DIAGNOSTICS_URL = '/api/topor-balancer/diagnostics/subscription'
const RUNTIME_CONFIG_HEALTH_URL = '/api/topor-balancer/runtime-config-health'

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
type DiscoveryItemStatus = 'conflict' | 'free' | 'in_other_group' | 'in_this_group'

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
    planCode: string
    publicHostCode: string
    publicName: string
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
    id: string
    nodeId: string
    planCode: string
    publicHostCode: string
    shortUuid: string
    technicalHostName?: string
    updatedAt?: string
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
    pbk?: string
    port?: number
    protocol?: 'vless'
    rawRemark?: string
    remnawaveNodeName?: string
    remnawaveNodeUuid?: string
    security?: string
    sid?: string
    sni?: string
    technicalHostName: string
    type?: string
    status?: DiscoveryItemStatus
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
    format: 'base64' | 'plain' | 'unknown'
    inputLinksCount: number
    outputLinksCount: number
    groups: Array<{
        publicHostCode: string
        planCode: string
        selectedTechnicalHostName?: string
        status: 'fail-open' | 'no-active-node' | 'ok'
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
    return value.trim()
}

function getDiagnosticsStatusColor(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const colors: Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string> = {
        'fail-open': 'yellow',
        'no-active-node': 'red',
        ok: 'green'
    }

    return colors[status]
}

function getDiagnosticsStatusLabel(status: SubscriptionDiagnosticsResult['groups'][number]['status']) {
    const labels: Record<SubscriptionDiagnosticsResult['groups'][number]['status'], string> = {
        'fail-open': 'Исходные ссылки',
        'no-active-node': 'Нет активной ноды',
        ok: 'Готово'
    }

    return labels[status]
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
    const [assignments, setAssignments] = useState<ToporBalancerAssignment[]>([])
    const [requests, setRequests] = useState<ToporBalancerRequest[]>([])
    const [discoveredHosts, setDiscoveredHosts] = useState<DiscoveredHost[]>([])
    const [selectedHosts, setSelectedHosts] = useState<string[]>([])
    const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
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
        locationCode: 'FI',
        planCode: 'standard',
        publicHostCode: 'fi_standard',
        publicName: '🇫🇮 Финляндия'
    })

    const isLoggedIn = Boolean(adminToken)
    const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null
    const selectedGroupNodes = useMemo(
        () => nodes.filter((node) => selectedGroup && node.groupId === selectedGroup.id),
        [nodes, selectedGroup]
    )
    const selectedGroupAssignments = useMemo(() => {
        const selectedNodeIds = new Set(selectedGroupNodes.map((node) => node.id))

        return assignments.filter((assignment) => selectedNodeIds.has(assignment.nodeId))
    }, [assignments, selectedGroupNodes])
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

    const refreshAdminData = useCallback(async () => {
        if (!adminToken) {
            return
        }

        setIsLoading(true)
        setErrorMessage('')

        try {
            const [healthResponse, runtimeResponse, groupsResponse, nodesResponse, assignmentsResponse, requestsResponse] =
                await Promise.all([
                    fetchAdminJson<ToporBalancerHealth>(ADMIN_HEALTH_URL),
                    fetchAdminJson<RuntimeConfigHealth>(RUNTIME_CONFIG_HEALTH_URL),
                    fetchAdminJson<ToporBalancerGroup[]>(ADMIN_GROUPS_URL),
                    fetchAdminJson<ToporBalancerNode[]>(ADMIN_NODES_URL),
                    fetchAdminJson<ToporBalancerAssignment[]>(ADMIN_ASSIGNMENTS_URL),
                    fetchAdminJson<ToporBalancerRequest[]>(ADMIN_REQUESTS_URL)
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
        setAssignments([])
        setRequests([])
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
            notifications.show({ color: 'green', message: texts.messages.nodeDeleted, title: texts.common.ready })
        } catch (error) {
            setErrorMessage(getAdminErrorMessage(error, texts.messages.nodeDeleteFailed))
        } finally {
            setIsLoading(false)
        }
    }

    const runApiDiscovery = async () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.discovery.selectGroup, title: texts.common.noGroup })
            return
        }

        setIsDiscoveryLoading(true)
        setErrorMessage('')

        try {
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
        }

        setSelectedGroupId(group.id)
        setGroupEditorTab(tab)
        setIsGroupEditorOpen(true)
    }

    const openAddNodesFlow = () => {
        if (!selectedGroup) {
            notifications.show({ color: 'red', message: texts.messages.selectGroupFirst, title: texts.common.noGroup })
            return
        }

        setGroupEditorTab('discovery')
        setIsGroupEditorOpen(true)

        if (discoveredHosts.length === 0) {
            void runApiDiscovery()
        }
    }

    const importSelectedHosts = async () => {
        if (selectedHosts.length === 0) {
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
                    technicalHostNames: selectedHosts
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
                                  locationCode: importGroupForm.locationCode.trim() || undefined,
                                  planCode: importGroupForm.planCode.trim(),
                                  publicHostCode: importGroupForm.publicHostCode.trim(),
                                  publicName: importGroupForm.publicName.trim()
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
                            <Tabs.Tab value="discovery">Найти в Remnawave</Tabs.Tab>
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
                                <TechnicalNodesTable
                                    deleteNode={deleteNode}
                                    discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                    nodes={selectedGroupNodes}
                                    patchNode={patchNode}
                                />
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
                                <TechnicalNodesTable
                                    deleteNode={deleteNode}
                                    discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                    nodes={selectedGroupNodes}
                                    patchNode={patchNode}
                                />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="discovery">
                            <Stack gap="md">
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Group align="end" justify="space-between">
                                        <Group align="end">
                                            <Button leftSection={<IconRefresh size={16} />} loading={isDiscoveryLoading} onClick={runApiDiscovery} variant="light">
                                                Обновить список
                                            </Button>
                                            <TextInput
                                                label="UUID тестовой подписки"
                                                onChange={(event) => setShortUuid(event.currentTarget.value)}
                                                placeholder="Введите UUID"
                                                value={shortUuid}
                                            />
                                            <Button leftSection={<IconSearch size={16} />} loading={isDiscoveryLoading} onClick={runSubscriptionDiscovery} variant="light">
                                                Сканировать подписку
                                            </Button>
                                        </Group>
                                        <Button disabled={selectedHosts.length === 0} leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={importSelectedHosts}>
                                            Импортировать выбранные
                                        </Button>
                                    </Group>
                                </Card>
                                <DiscoveredHostsTable
                                    hosts={discoveredHosts}
                                    importedByTechnicalHostName={importedByTechnicalHostName}
                                    importStatuses={discoveryImportStatuses}
                                    selectedGroup={selectedGroup}
                                    selectedHosts={selectedHosts}
                                    toggleSelectedHost={toggleSelectedHost}
                                />
                                {lastImportResult && <ImportResultSummary result={lastImportResult} />}
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="assignments">
                            <AssignmentsTable assignments={selectedGroupAssignments} nodes={selectedGroupNodes} />
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="diagnostics">
                            <Stack gap="md">
                                <Card className={classes.tableCard} p="md" radius="md">
                                    <Stack gap="md">
                                        <Group justify="space-between">
                                            <Title order={4}>{texts.diagnostics.subscriptionTitle}</Title>
                                            {subscriptionDiagnostics && (
                                                <Badge color={subscriptionDiagnostics.ok ? 'green' : subscriptionDiagnostics.errors.length > 0 ? 'red' : 'yellow'} variant="light">
                                                    {subscriptionDiagnostics.ok ? texts.diagnostics.resultOk : texts.diagnostics.resultProblem}
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
                                                    <Badge variant="light">Формат: {subscriptionDiagnostics.format}</Badge>
                                                    <Badge variant="light">Входящих VLESS: {subscriptionDiagnostics.inputLinksCount}</Badge>
                                                    <Badge variant="light">Исходящих VLESS: {subscriptionDiagnostics.outputLinksCount}</Badge>
                                                </Group>
                                                <DiagnosticsSummary result={subscriptionDiagnostics} />
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
                                    {texts.diagnostics.runtimeConfig}: {runtimeHealth?.appConfigRoute ?? '/assets/.app-config-v2.json'}; источник: {runtimeHealth?.lastConfigSource ?? '-'}; ошибка: {runtimeHealth?.lastRuntimeConfigError ?? '-'}
                                </Alert>
                                <RequestsTable requests={requests} />
                            </Stack>
                        </Tabs.Panel>

                        <Tabs.Panel pt="md" value="settings">
                            <GroupSettingsForm group={selectedGroup} isLoading={isLoading} patchGroup={patchGroup} />
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
                                        label={<FieldLabel help={tooltips.planCode} label={texts.fields.planCode} />}
                                        onChange={(event) => setImportGroupForm((current) => ({ ...current, planCode: event.currentTarget.value }))}
                                        value={importGroupForm.planCode}
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

                                            <TechnicalNodesTable
                                                deleteNode={deleteNode}
                                                discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                                nodes={selectedGroupNodes}
                                                patchNode={patchNode}
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

                                        <TechnicalNodesTable
                                            deleteNode={deleteNode}
                                            discoveredByTechnicalHostName={discoveredByTechnicalHostName}
                                            nodes={selectedGroupNodes}
                                            patchNode={patchNode}
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
                                            <Button disabled={selectedHosts.length === 0} leftSection={<IconDownload size={16} />} loading={isDiscoveryLoading} onClick={importSelectedHosts}>
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
                                                        <Badge color={subscriptionDiagnostics.ok ? 'green' : subscriptionDiagnostics.errors.length > 0 ? 'red' : 'yellow'} variant="light">
                                                            {subscriptionDiagnostics.ok ? texts.diagnostics.resultOk : texts.diagnostics.resultProblem}
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
                                                        </SimpleGrid>
                                                        <DiagnosticsSummary result={subscriptionDiagnostics} />
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
    patchGroup
}: {
    group: ToporBalancerGroup
    isLoading: boolean
    patchGroup: (group: ToporBalancerGroup, patch: Partial<ToporBalancerGroup>) => void
}) {
    const [form, setForm] = useState({
        enabled: group.enabled,
        locationCode: group.locationCode ?? '',
        planCode: group.planCode,
        publicHostCode: group.publicHostCode,
        publicName: group.publicName,
        strategy: group.strategy
    })

    useEffect(() => {
        setForm({
            enabled: group.enabled,
            locationCode: group.locationCode ?? '',
            planCode: group.planCode,
            publicHostCode: group.publicHostCode,
            publicName: group.publicName,
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
    return (
        <Stack gap="md">
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

function TechnicalNodesTable({
    deleteNode,
    discoveredByTechnicalHostName,
    nodes,
    patchNode
}: {
    deleteNode: (node: ToporBalancerNode) => void
    discoveredByTechnicalHostName: Map<string, DiscoveredHost>
    nodes: ToporBalancerNode[]
    patchNode: (node: ToporBalancerNode, patch: Partial<ToporBalancerNode>) => void
}) {
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
                                    <Table.Td>{node.assignedUsers}</Table.Td>
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
        return { color: 'gray', label: texts.discovery.canImport, tooltip: texts.tooltips.discovered }
    }

    if (host.status === 'in_this_group') {
        return { color: 'green', label: texts.discovery.alreadyInGroup, tooltip: host.currentGroupName ?? texts.tooltips.imported }
    }

    if (host.status === 'in_other_group') {
        return { color: 'yellow', label: texts.discovery.conflict, tooltip: host.currentGroupName ?? undefined }
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

    return { color: 'gray', label: texts.discovery.canImport, tooltip: texts.tooltips.discovered }
}

function DiscoveredHostsTable({
    hosts,
    importedByTechnicalHostName,
    importStatuses,
    selectedGroup,
    selectedHosts,
    toggleSelectedHost
}: {
    hosts: DiscoveredHost[]
    importedByTechnicalHostName: Map<string, ToporBalancerNode>
    importStatuses: Record<string, DiscoveryImportStatusState>
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
                            <Table.Th>Статус</Table.Th>
                            <Table.Th>Хост</Table.Th>
                            <Table.Th>Порт</Table.Th>
                            <Table.Th>Протокол</Table.Th>
                            <Table.Th>Защита</Table.Th>
                            <Table.Th>Транспорт</Table.Th>
                            <Table.Th>Серверное имя</Table.Th>
                            <Table.Th>Поток</Table.Th>
                            <Table.Th>Ключи</Table.Th>
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
                                    <Table.Td>{redactSensitiveText(host.host)}</Table.Td>
                                    <Table.Td>{host.port ?? '-'}</Table.Td>
                                    <Table.Td>{host.protocol ?? '-'}</Table.Td>
                                    <Table.Td>{host.security ?? '-'}</Table.Td>
                                    <Table.Td>{host.type ?? '-'}</Table.Td>
                                    <Table.Td>{redactSensitiveText(host.sni)}</Table.Td>
                                    <Table.Td>{host.flow ?? '-'}</Table.Td>
                                    <Table.Td>{[host.pbk, host.sid].filter(Boolean).join(' / ') || '-'}</Table.Td>
                                </Table.Tr>
                            )
                        })}
                    </Table.Tbody>
                </Table>
            </ScrollArea>
        </Card>
    )
}

function AssignmentsTable({ assignments, nodes }: { assignments: ToporBalancerAssignment[]; nodes: ToporBalancerNode[] }) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]))

    return (
        <Card className={classes.tableCard} p={0} radius="md">
            <ScrollArea>
                <Table className={classes.assignmentsTable} highlightOnHover stickyHeader>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>UUID подписки</Table.Th>
                            <Table.Th>Код группы</Table.Th>
                            <Table.Th>Тариф</Table.Th>
                            <Table.Th>Техническая нода</Table.Th>
                            <Table.Th>Обновлено</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {assignments.map((assignment) => (
                            <Table.Tr key={assignment.id}>
                                <Table.Td>{maskShort(assignment.shortUuid)}</Table.Td>
                                <Table.Td>{assignment.publicHostCode}</Table.Td>
                                <Table.Td>{assignment.planCode}</Table.Td>
                                <Table.Td>{assignment.technicalHostName || nodeById.get(assignment.nodeId)?.technicalHostName || '-'}</Table.Td>
                                <Table.Td>{formatDate(assignment.updatedAt)}</Table.Td>
                            </Table.Tr>
                        ))}
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
