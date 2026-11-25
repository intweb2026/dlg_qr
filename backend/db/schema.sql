-- Tables used by the feedback API. Same layout the Django backend created, so an existing database works as it is.
-- Every statement is safe to run again, npm run migrate applies this file.

CREATE TABLE IF NOT EXISTS `admin_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(150) NOT NULL,
  `password` varchar(255) NOT NULL,
  `full_name` varchar(255) NOT NULL DEFAULT '',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `last_login` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `admin_tokens` (
  `key` varchar(64) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `user_id` int NOT NULL,
  PRIMARY KEY (`key`),
  KEY `admin_tokens_user_id_f1a1f122_fk_admin_users_id` (`user_id`),
  CONSTRAINT `admin_tokens_user_id_f1a1f122_fk_admin_users_id` FOREIGN KEY (`user_id`) REFERENCES `admin_users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `attendees` (
  `attendee_id` int NOT NULL AUTO_INCREMENT,
  `full_name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `company_name` varchar(255) NOT NULL DEFAULT '',
  -- 1 when the attendee typed a name that was not on the list and was added on the feedback form.
  `is_walk_in` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  PRIMARY KEY (`attendee_id`),
  UNIQUE KEY `email` (`email`),
  KEY `attendees_full_name_9821c284` (`full_name`),
  KEY `attendees_is_walk_in_idx` (`is_walk_in`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The unique attendee_id means one feedback per attendee, enforced by the database too.
CREATE TABLE IF NOT EXISTS `feedback_submissions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `device_fingerprint` varchar(255) NOT NULL,
  `feedback_data` json NOT NULL,
  -- Name and company as confirmed on the Your Display Name popup, edited or not.
  `userAliesName` varchar(255) NOT NULL DEFAULT '',
  `userComapnyAliesName` varchar(255) NOT NULL DEFAULT '',
  `is_suspended` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime(6) NOT NULL,
  `attendee_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `attendee_id` (`attendee_id`),
  KEY `feedback_submissions_device_fingerprint_0748b0c6` (`device_fingerprint`),
  CONSTRAINT `feedback_submissions_attendee_id_c32a479b_fk_attendees` FOREIGN KEY (`attendee_id`) REFERENCES `attendees` (`attendee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Single row with id 1 holding the global form configuration. max_spin_attempts 0 means unlimited.
-- form_status is no longer used, the feedback form is always open. The column is kept so existing databases need no change.
CREATE TABLE IF NOT EXISTS `form_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `form_status` varchar(10) NOT NULL DEFAULT 'active',
  `max_spin_attempts` int unsigned NOT NULL DEFAULT 0,
  `updated_at` datetime(6) NOT NULL,
  `spin_duration_seconds` int unsigned NOT NULL DEFAULT 5,
  -- When the registered delegates were last copied from the CRM and how many there were, null until the first sync.
  `crm_synced_at` datetime(6) DEFAULT NULL,
  `crm_synced_count` int unsigned DEFAULT NULL,
  -- 1: the feedback form opens by itself at 12:00 AM of the event's first day where it is held. 0: always open.
  `form_open_auto` tinyint(1) NOT NULL DEFAULT 1,
  -- When the feedback submissions PDF was last emailed and how many submissions it had, null until it is sent.
  `report_sent_at` datetime(6) DEFAULT NULL,
  `report_sent_count` int unsigned DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Log of revealed winners, so results survive a page refresh.
CREATE TABLE IF NOT EXISTS `lucky_draw_winners` (
  `id` int NOT NULL AUTO_INCREMENT,
  `attempt_number` int unsigned NOT NULL DEFAULT 1,
  `drawn_at` datetime(6) NOT NULL,
  `drawn_by_id` int DEFAULT NULL,
  `submission_id` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `lucky_draw_winners_submission_id_6e52d8e8_fk_feedback_` (`submission_id`),
  KEY `lucky_draw_winners_drawn_by_id_6c221596_fk_admin_users_id` (`drawn_by_id`),
  CONSTRAINT `lucky_draw_winners_drawn_by_id_6c221596_fk_admin_users_id` FOREIGN KEY (`drawn_by_id`) REFERENCES `admin_users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `lucky_draw_winners_submission_id_6e52d8e8_fk_feedback_` FOREIGN KEY (`submission_id`) REFERENCES `feedback_submissions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The event's content shown on the site, a single row with id 1, edited on the admin Event Details page.
-- Created from the event's entry in events.json the first time it is read. Blank values are left out of the site config.
-- Media values are site paths like /images/dle26/logo.png, full URLs, or /uploads/<code>/<file> for files uploaded
-- on the admin page, which the API serves at /api/uploads/.
CREATE TABLE IF NOT EXISTS `event_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL DEFAULT '',
  `tagline` varchar(1000) NOT NULL DEFAULT '',
  `secondary_color` varchar(7) NOT NULL DEFAULT '',
  `logo` varchar(500) NOT NULL DEFAULT '',
  `favicon` varchar(500) NOT NULL DEFAULT '',
  `hero_video_mp4` varchar(500) NOT NULL DEFAULT '',
  `hero_video_webm` varchar(500) NOT NULL DEFAULT '',
  `hero_poster` varchar(500) NOT NULL DEFAULT '',
  `background` varchar(500) NOT NULL DEFAULT '',
  `venue_logo` varchar(500) NOT NULL DEFAULT '',
  `wifi_qr` varchar(500) NOT NULL DEFAULT '',
  `website_url` varchar(500) NOT NULL DEFAULT '',
  `wifi_network` varchar(255) NOT NULL DEFAULT '',
  `wifi_password` varchar(255) NOT NULL DEFAULT '',
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- The buttons on the event home page, shown by sort_order then id. target is a page of the event (/feedback-form),
-- "website" for the event's website link, or a full URL. Hidden items stay here but are not shown.
CREATE TABLE IF NOT EXISTS `menu_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `label` varchar(100) NOT NULL,
  `icon` varchar(500) NOT NULL DEFAULT '',
  `target` varchar(500) NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `is_visible` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `menu_items_sort_order_idx` (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
