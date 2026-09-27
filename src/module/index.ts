import { defineModule } from '@directus/extensions-sdk';
import { userHasAdminAccess } from '../shared/admin';
import { installUsersHeaderAction } from './inject-users-header';
import WizardView from './wizard-view.vue';

installUsersHeaderAction();

export default defineModule({
	id: 'user-cleanup',
	name: 'User Cleanup',
	icon: 'person_remove',
	routes: [
		{
			path: '',
			component: WizardView,
		},
	],
	preRegisterCheck(user) {
		return userHasAdminAccess(user);
	},
});
