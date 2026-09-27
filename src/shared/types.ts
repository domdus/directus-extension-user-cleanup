export type ReferenceAction = 'null' | 'reassign' | 'delete_rows' | 'skip';

export type ReferenceKind = 'auth' | 'inbox' | 'preset' | 'junction' | 'system' | 'content';

export type CleanupUser = {
	id: string;
	email: string | null;
	firstName: string | null;
	lastName: string | null;
	status: string | null;
	admin: boolean;
	self: boolean;
};

export type UserReference = {
	collection: string;
	field: string;
	nullable: boolean;
	onDelete: string;
	junction: boolean;
	kind: ReferenceKind;
	count: number;
	blocks: boolean;
	countsByUser: Record<string, number>;
	allowedActions: ReferenceAction[];
	suggestedAction: ReferenceAction;
};

export type Resolution = {
	collection: string;
	field: string;
	action: ReferenceAction;
	reassignTo?: string | null;
};

export type InspectResult = {
	users: CleanupUser[];
	references: UserReference[];
	reassignCandidates: CleanupUser[];
};

export type AppliedResolution = {
	collection: string;
	field: string;
	action: ReferenceAction;
	affected: number;
};

export type DeleteResult = {
	deletedUserIds: string[];
	applied: AppliedResolution[];
};
