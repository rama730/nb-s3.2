'use server';

import {
    applyToRoleAction as applyToRoleActionImpl,
    editPendingApplicationAction as editPendingApplicationActionImpl,
    withdrawApplicationAction as withdrawApplicationActionImpl,
} from './apply';
import {
    acceptApplicationAction as acceptApplicationActionImpl,
    rejectApplicationAction as rejectApplicationActionImpl,
    reopenApplicationAction as reopenApplicationActionImpl,
} from './review';
import {
    getApplicationStatusAction as getApplicationStatusActionImpl,
    getMyApplicationsAction as getMyApplicationsActionImpl,
    getIncomingApplicationsAction as getIncomingApplicationsActionImpl,
    getInboxApplicationsAction as getInboxApplicationsActionImpl,
    getApplicationRequestHistory as getApplicationRequestHistoryImpl,
} from './queries';
import type { ApplicationActionOptions, ApplicationCursorPaginationInput } from './types';

export type {
    ApplicationRequestHistoryItem,
    ApplicationActionOptions,
    ApplicationActionResult,
    ApplicationCursorPaginationInput,
} from './types';

export async function getApplicationStatusAction(projectId: string) {
    return getApplicationStatusActionImpl(projectId);
}

export async function applyToRoleAction(
    projectId: string,
    roleId: string,
    message: string,
    options?: ApplicationActionOptions
) {
    return applyToRoleActionImpl(projectId, roleId, message, options);
}

export async function acceptApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
) {
    return acceptApplicationActionImpl(applicationId, message, options);
}

export async function rejectApplicationAction(
    applicationId: string,
    message?: string,
    reason?: string,
    options?: ApplicationActionOptions
) {
    return rejectApplicationActionImpl(applicationId, message, reason, options);
}

export async function editPendingApplicationAction(
    applicationId: string,
    message: string,
    options?: ApplicationActionOptions
) {
    return editPendingApplicationActionImpl(applicationId, message, options);
}

export async function withdrawApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
) {
    return withdrawApplicationActionImpl(applicationId, message, options);
}

export async function reopenApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
) {
    return reopenApplicationActionImpl(applicationId, message, options);
}

export async function getMyApplicationsAction(pagination?: ApplicationCursorPaginationInput) {
    return getMyApplicationsActionImpl(pagination);
}

export async function getIncomingApplicationsAction(
    paginationOrLimit: ApplicationCursorPaginationInput | number = 20,
    offset: number = 0
) {
    return getIncomingApplicationsActionImpl(paginationOrLimit, offset);
}

export async function getInboxApplicationsAction(limit: number = 20, offset: number = 0) {
    return getInboxApplicationsActionImpl(limit, offset);
}

export async function getApplicationRequestHistory(limit: number = 80) {
    return getApplicationRequestHistoryImpl(limit);
}
