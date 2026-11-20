<?php
// A one-connection SMTP server on 127.0.0.1 for MailTest. Never deployed.
//   php fake-smtp.php <transcript-file> [<command-to-refuse>]
// Prints its port on the first line, serves one client, and writes every line the client sent to
// the transcript file. <command-to-refuse> is one of EHLO, AUTH, USER, PASS, MAIL, RCPT, DATA, END
// and is answered with 550 instead of success.
declare(strict_types=1);

$transcript = $argv[1];
$refuse = $argv[2] ?? '';

$server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
if (!$server) exit(1);
echo explode(':', (string)stream_socket_get_name($server, false))[1], "\n";
fflush(STDOUT);

$conn = stream_socket_accept($server, 10);
if (!$conn) exit(1);

$log = [];
$say = static fn(string $line) => fwrite($conn, $line . "\r\n");
$reply = static fn(string $stage, string $ok) => $say($refuse === $stage ? '550 refused' : $ok);

$say('220 fake ESMTP');
$state = 'cmd';
while (($line = fgets($conn, 4096)) !== false) {
    $line = rtrim($line, "\r\n");
    $log[] = $line;
    if ($state === 'data') {
        if ($line === '.') {
            $state = 'cmd';
            $reply('END', '250 queued');
        }
        continue;
    }
    if ($state === 'user') { $state = 'pass'; $reply('USER', '334 UGFzc3dvcmQ6'); continue; }
    if ($state === 'pass') { $state = 'cmd'; $reply('PASS', '235 ok'); continue; }
    $verb = strtoupper(strtok($line, ' ') ?: '');
    switch ($verb) {
        case 'EHLO': $reply('EHLO', '250 fake'); break;
        case 'AUTH': $state = 'user'; $reply('AUTH', '334 VXNlcm5hbWU6'); break;
        case 'MAIL': $reply('MAIL', '250 ok'); break;
        case 'RCPT': $reply('RCPT', '250 ok'); break;
        case 'DATA': $state = 'data'; $reply('DATA', '354 go'); break;
        case 'QUIT': $say('221 bye'); break 2;
        default: $say('500 what');
    }
}
file_put_contents($transcript, implode("\n", $log) . "\n");
