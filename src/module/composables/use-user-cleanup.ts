import { ref } from 'vue';
import { useApi } from '@directus/extensions-sdk';
import { ENDPOINT_NAME } from '../../shared/config';
import type { CleanupUser, DeleteResult, InspectResult, Resolution } from '../../shared/types';

export function useUserCleanup() {
	const api = useApi();
	const loading = ref(false);
	const error = ref<string | null>(null);
	const users = ref<CleanupUser[]>([]);

	async function loadUsers() {
		loading.value = true;
		error.value = null;
		try {
			const { data } = await api.get(`/${ENDPOINT_NAME}`);
			users.value = data?.data?.users || [];
		} catch (err: any) {
			error.value = err?.response?.data?.errors?.[0]?.message || err?.message || 'Failed to load users';
		} finally {
			loading.value = false;
		}
	}

	async function inspect(userIds: string[]): Promise<InspectResult> {
		const { data } = await api.post(`/${ENDPOINT_NAME}/inspect`, { userIds });
		return data.data as InspectResult;
	}

	async function deleteUsers(userIds: string[], resolutions: Resolution[]): Promise<DeleteResult> {
		const { data } = await api.post(`/${ENDPOINT_NAME}/delete`, { userIds, resolutions });
		return data.data as DeleteResult;
	}

	return {
		loading,
		error,
		users,
		loadUsers,
		inspect,
		deleteUsers,
	};
}
