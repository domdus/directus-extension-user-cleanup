export function getDirectusApp(): any {
	return (document.querySelector('#app') as any)?.__vue_app__ || null;
}

/** Vue 3.5 leaves app._instance null; the live root is on the mount element's vnode. */
export function getDirectusRoot(): any {
	const root = document.querySelector('#app') as any;
	return root?._vnode?.component || root?.__vue_app__?._instance || null;
}

export function getDirectusRouter(): {
	push?: (to: { path: string; query?: Record<string, string> }) => void;
	afterEach?: (hook: () => void) => () => void;
} | null {
	return getDirectusApp()?.config?.globalProperties?.$router || null;
}

export function getPinia(): any {
	return getDirectusApp()?.config?.globalProperties?.$pinia || null;
}
