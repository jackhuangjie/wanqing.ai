CREATE TABLE `daily_usage` (
	`day` text NOT NULL,
	`viewer` text NOT NULL,
	`attempts` integer NOT NULL,
	PRIMARY KEY(`day`, `viewer`)
);
