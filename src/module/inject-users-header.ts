import { userHasAdminAccess } from '../shared/admin';
import { getDirectusRoot, getDirectusRouter, getPinia } from './directus-app';

const BUTTON_ID = 'user-cleanup-header-action';
const FLAG = '__userCleanupHeaderInstalled';

const USERS_DIRECTORY = /\/users(?:\/(?:suspended|invited|all))?$/;

function isUsersDirectory(): boolean {
	const path = window.location.pathname.replace(/\/+$/, '') || '/';
	return USERS_DIRECTORY.test(path);
}

function isCleanupAdmin(): boolean {
	try {
		const store = getPinia()?._s?.get?.('userStore');
		if (!store) return false;
		if (store.isAdmin === true) return true;
		return userHasAdminAccess(store.currentUser);
	} catch {
		return false;
	}
}

function isModuleEnabled(): boolean {
	try {
		const settings = getPinia()?._s?.get?.('settingsStore')?.settings;
		const bar = settings?.module_bar;
		if (!Array.isArray(bar)) return true;
		const entry = bar.find((module: { id?: string; type?: string }) => module?.type === 'module' && module?.id === 'user-cleanup');
		if (!entry) return true;
		return entry.enabled !== false;
	} catch {
		return true;
	}
}

function walkVNode(vnode: any, visit: (instance: any) => void, seen: Set<any>): void {
	if (!vnode || typeof vnode !== 'object') return;
	if (vnode.component) walkInstance(vnode.component, visit, seen);
	const children = vnode.children;
	if (Array.isArray(children)) {
		for (const child of children) walkVNode(child, visit, seen);
	}
	const dynamic = vnode.dynamicChildren;
	if (Array.isArray(dynamic)) {
		for (const child of dynamic) walkVNode(child, visit, seen);
	}
}

function walkInstance(instance: any, visit: (instance: any) => void, seen: Set<any>): void {
	if (!instance || seen.has(instance)) return;
	seen.add(instance);
	visit(instance);
	walkVNode(instance.subTree, visit, seen);
}

function readUsersSelection(): string[] {
	const root = getDirectusRoot();
	if (!root) return [];

	let selected: string[] = [];
	walkInstance(
		root,
		(instance) => {
			const props = instance.props;
			if (props?.collection !== 'directus_users' || !Array.isArray(props.selection)) return;
			if (props.selection.length > selected.length) {
				selected = props.selection.map((id: unknown) => String(id)).filter(Boolean);
			}
		},
		new Set(),
	);
	return selected;
}

function headerBar(): HTMLElement | null {
	return document.querySelector('header.header-bar');
}

function headerActions(): HTMLElement | null {
	const header = headerBar();
	const parent = header?.parentElement;
	if (!parent) return null;
	const direct = parent.querySelector(':scope > .actions');
	if (direct instanceof HTMLElement) return direct;
	const nested = parent.querySelector('.actions');
	return nested instanceof HTMLElement ? nested : null;
}

function selectionDeleteButton(): HTMLElement | null {
	return headerActions()?.querySelector<HTMLElement>('.action-delete') || null;
}

/** Direct child of the header actions slot, so the button is not inside the delete dialog. */
function slotAnchor(button: HTMLElement): HTMLElement {
	const actions = headerActions();
	let node = button;
	while (actions && node.parentElement && node.parentElement !== actions) node = node.parentElement;
	return node;
}

function retargetIcon(root: HTMLElement): void {
	const named = root.querySelector<HTMLElement>('[data-icon]');
	if (named) {
		named.setAttribute('data-icon', 'person_remove');
		return;
	}
	const icon = root.querySelector('.v-icon');
	if (icon) icon.innerHTML = '<i data-icon="person_remove"></i>';
}

function createButton(template: HTMLElement, ids: string[]): HTMLElement {
	const button = template.cloneNode(true) as HTMLElement;
	button.id = BUTTON_ID;
	button.classList.remove('action-delete', 'disabled');
	button.classList.add('action-user-cleanup');
	button.removeAttribute('disabled');
	button.querySelectorAll('[disabled]').forEach((node) => node.removeAttribute('disabled'));
	button.setAttribute('aria-label', 'User Cleanup');
	button.setAttribute('title', 'User Cleanup');
	button.dataset.ids = ids.join(',');
	retargetIcon(button);
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		const selected = readUsersSelection();
		if (selected.length === 0) return;
		const router = getDirectusRouter();
		const query = { users: selected.join(',') };
		if (router?.push) router.push({ path: '/user-cleanup', query });
	});
	return button;
}

function sync(): void {
	const existing = document.getElementById(BUTTON_ID);
	const deleteButton = isUsersDirectory() && isCleanupAdmin() && isModuleEnabled() ? selectionDeleteButton() : null;
	const ids = deleteButton ? readUsersSelection() : [];

	if (!deleteButton || ids.length === 0) {
		existing?.remove();
		return;
	}

	const anchor = slotAnchor(deleteButton);
	if (existing?.dataset.ids === ids.join(',') && existing.nextElementSibling === anchor) return;

	existing?.remove();
	anchor.parentElement?.insertBefore(createButton(deleteButton, ids), anchor);
}

export function installUsersHeaderAction(): void {
	if (typeof window === 'undefined') return;
	if ((window as unknown as Record<string, boolean>)[FLAG]) return;
	(window as unknown as Record<string, boolean>)[FLAG] = true;

	const start = () => {
		let timer = 0;
		let observer: MutationObserver | null = null;
		let observed: HTMLElement | null = null;

		const schedule = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(sync, 60);
		};

		const watch = () => {
			const root = headerBar()?.parentElement || document.body;
			if (observed === root) return;
			observer?.disconnect();
			observed = root;
			observer = new MutationObserver(schedule);
			observer.observe(root, { childList: true, subtree: true });
		};

		const run = () => {
			watch();
			sync();
		};

		run();
		getDirectusRouter()?.afterEach?.(() => {
			window.setTimeout(run, 30);
		});
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}
}
