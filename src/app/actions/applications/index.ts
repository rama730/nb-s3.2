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

export type { ApplicationRequestHistoryItem } from './types';

export async function getApplicationStatusAction(projectId: string) {
    return getApplicationStatusActionImpl(projectId);
}

export async function applyToRoleAction(projectId: string, roleId: string, message: string) {
    return applyToRoleActionImpl(projectId, roleId, message);
}

export async function acceptApplicationAction(applicationId: string, message?: string) {
    return acceptApplicationActionImpl(applicationId, message);
}

export async function rejectApplicationAction(
    applicationId: string,
    message?: string,
    reason?: string,
) {
    return rejectApplicationActionImpl(applicationId, message, reason);
}

export async function editPendingApplicationAction(applicationId: string, message: string) {
    return editPendingApplicationActionImpl(applicationId, message);
}

export async function withdrawApplicationAction(applicationId: string) {
    return withdrawApplicationActionImpl(applicationId);
}

export async function reopenApplicationAction(applicationId: string, message?: string) {
    return reopenApplicationActionImpl(applicationId, message);
}

export async function getMyApplicationsAction() {
    return getMyApplicationsActionImpl();
}

export async function getIncomingApplicationsAction(limit: number = 20, offset: number = 0) {
    return getIncomingApplicationsActionImpl(limit, offset);
}

export async function getInboxApplicationsAction(limit: number = 20, offset: number = 0) {
    return getInboxApplicationsActionImpl(limit, offset);
}

export async function getApplicationRequestHistory(limit: number = 80) {
    return getApplicationRequestHistoryImpl(limit);
}
