<?php
/**
 * Plugin Name:       OpenPush
 * Plugin URI:        https://openpush.ai
 * Description:       Web push for your site with OpenPush. Adds the OpenPush script and worker file, and can send a push when you publish a post.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            OpenPush
 * Author URI:        https://openpush.ai
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       openpush
 *
 * @package OpenPush
 */

defined( 'ABSPATH' ) || exit;

define( 'OPENPUSH_VERSION', '1.0.0' );
define( 'OPENPUSH_FILE', __FILE__ );
define( 'OPENPUSH_DIR', __DIR__ );

require_once OPENPUSH_DIR . '/includes/class-openpush-settings.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-worker.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-snippet.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-connection.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-push-payload.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-frontend.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-admin.php';
require_once OPENPUSH_DIR . '/includes/class-openpush-publish.php';

register_activation_hook( __FILE__, array( 'OpenPush_Admin', 'activate' ) );

OpenPush_Frontend::register();
OpenPush_Publish::register();
if ( is_admin() ) {
	OpenPush_Admin::register();
}
