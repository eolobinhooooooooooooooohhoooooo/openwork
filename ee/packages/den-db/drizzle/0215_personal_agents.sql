CREATE TABLE `personal_agent_revision` (
	`id` varchar(64) NOT NULL,
	`agent_id` varchar(64) NOT NULL,
	`version` int NOT NULL,
	`brief` mediumtext NOT NULL,
	`tool_policy` json NOT NULL,
	`default_execution_target` enum('desktop','cloud') NOT NULL DEFAULT 'cloud',
	`monthly_budget_micros` bigint unsigned,
	`digest` varchar(128) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_revision_id` PRIMARY KEY(`id`),
	CONSTRAINT `personal_agent_revision_version` UNIQUE(`agent_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `personal_agent` (
	`id` varchar(64) NOT NULL,
	`organization_id` varchar(64) NOT NULL,
	`owner_member_id` varchar(64) NOT NULL,
	`name` varchar(120) NOT NULL,
	`state` enum('active','archived') NOT NULL DEFAULT 'active',
	`current_revision_id` varchar(64) NOT NULL,
	`archived_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
	CONSTRAINT `personal_agent_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `automation_revision` ADD `agent_revision_id` varchar(64);--> statement-breakpoint
ALTER TABLE `automation` ADD `agent_id` varchar(64);--> statement-breakpoint
CREATE INDEX `personal_agent_org_owner_state` ON `personal_agent` (`organization_id`,`owner_member_id`,`state`);--> statement-breakpoint
CREATE INDEX `automation_agent` ON `automation` (`agent_id`);