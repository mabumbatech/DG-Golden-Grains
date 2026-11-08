<?php
ini_set('display_errors', 0);
error_reporting(E_ALL);


set_error_handler(function ($severity, $message, $file, $line) {
    if (!(error_reporting() & $severity)) return false;
    throw new ErrorException($message, 0, $severity, $file, $line);
});

set_exception_handler(function (Throwable $e) {
    while (ob_get_level() > 0) { ob_end_clean(); }
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage(),
    ]);
    exit;
});

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'lifetime' => 60 * 60 * 24 * 7, // 7 days
        'path'     => '/',
        'samesite' => 'Lax',
    ]);
    session_start();
    // Reading data never changes the session, so release the session lock right away.
    // Otherwise PHP makes every request of the same person wait for the previous one.
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
        session_write_close();
    }
}

header('Content-Type: application/json; charset=utf-8');

/**
 * Send a JSON response and stop execution.
 */
function respond(bool $success, $data = null, string $message = '', int $code = 200): void
{
    http_response_code($code);
    $out = ['success' => $success];
    if ($message !== '') $out['message'] = $message;
    if ($data !== null) $out['data'] = $data;
    echo json_encode($out);
    exit;
}

/**
 * Read JSON body of the current request as assoc array.
 */
function body(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) return $_POST ?: [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Require an active logged-in session. Returns the user row.
 */
function require_login(): array
{
    if (empty($_SESSION['user_id'])) {
        respond(false, null, 'Please log in to continue.', 401);
    }
    $pdo = get_db();
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ? AND status = "active"');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user) {
        if (session_status() !== PHP_SESSION_ACTIVE) { session_start(); }
        session_destroy();
        respond(false, null, 'Session expired or account disabled. Please log in again.', 401);
    }
    return $user;
}

/**
 * Require the logged in user to have one of the given roles.
 */
function require_role(array $roles): array
{
    $user = require_login();
    if (!in_array($user['role'], $roles, true)) {
        respond(false, null, 'You do not have permission to perform this action.', 403);
    }
    return $user;
}

/**
 * Basic string cleanup.
 */
function clean(?string $val): string
{
    return trim(strip_tags((string)$val));
}

/**
 * Validate required fields are present & non-empty in an array.
 * Returns list of missing field names.
 */
function missing_fields(array $data, array $required): array
{
    $missing = [];
    foreach ($required as $f) {
        if (!isset($data[$f]) || $data[$f] === '' || $data[$f] === null) {
            $missing[] = $f;
        }
    }
    return $missing;
}

/**
 * Log a generic activity - kept lightweight (writes nothing sensitive).
 * Reserved for future use / extension.
 */
/** Quantities may have decimals (e.g. 2.5 kg). Stored with 3 decimal places. */
function to_qty($v): float
{
    return round((float)$v, 3);
}

/** Show a quantity without trailing zeros: 2.500 -> 2.5, 3.000 -> 3 */
function fmt_qty($v): string
{
    $s = number_format((float)$v, 3, '.', '');
    return rtrim(rtrim($s, '0'), '.');
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function today(): string
{
    return date('Y-m-d');
}
