<?php
// Executes the real handler and disk persistence with only WordPress boundaries stubbed.
define('ABSPATH', sys_get_temp_dir() . '/jetron-font-update-' . bin2hex(random_bytes(6)) . '/');
@mkdir(ABSPATH . 'constructor/src/config', 0777, true);
$allowed = true;
$validNonce = true;
$failSave = false;
$saveCalls = 0;
function add_action(...$args) {}
function current_user_can($cap) { global $allowed; return $allowed && $cap === 'manage_options'; }
function wp_verify_nonce($value, $action) { global $validNonce; return $validNonce && $value === 'test' && $action === 'jetron_admin'; }
function wp_unslash($v) { return stripslashes($v); }
function sanitize_text_field($v) { return trim(strip_tags($v)); }
function wp_json_encode($v, $flags) { return json_encode($v, $flags); }
function esc_attr($v) { return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8'); }
function esc_html($v) { return esc_attr($v); }
function submit_button($label, ...$args) { echo '<button type="submit">' . esc_html($label) . '</button>'; }
function jetron_admin_save($data) {
    global $failSave, $saveCalls;
    $saveCalls++;
    return $failSave ? false : jetron_admin_real_save($data);
}
$source = file_get_contents(dirname(__DIR__) . '/deploy/jetron-admin.php');
$source = preg_replace('/^<\?php\s*/', '', $source, 1);
$source = str_replace('function jetron_admin_save(', 'function jetron_admin_real_save(', $source);
eval($source);
$count = 0;
function check($condition, $message) {
    global $count;
    if (!$condition) { throw new RuntimeException($message); }
    $count++;
}
function fixture() {
    return array(
        'fonts' => array(
            array('id'=>'rpl','name'=>'РПЛ','file'=>'assets/fonts/rpl.ttf','cyrillic'=>true),
            array('id'=>'z','name'=>'Zulu','file'=>'assets/fonts/z.ttf','cyrillic'=>true,'extra'=>array('keep'=>42)),
            array('id'=>'a','name'=>'Alpha','file'=>'assets/fonts/a.ttf','cyrillic'=>false),
        ),
        'prices'=>array('gaiters'=>125), 'forms'=>array(array('id'=>'custom')), 'future'=>array('unknown'=>true)
    );
}
function setup_case($post = array()) {
    global $allowed, $validNonce, $failSave, $saveCalls;
    $allowed=true; $validNonce=true; $failSave=false; $saveCalls=0;
    file_put_contents(jetron_admin_file_path(), json_encode(fixture(), JSON_UNESCAPED_UNICODE));
    $_POST=array_merge(array('jetron_admin_action'=>'font_update','_wpnonce'=>'test','font_id'=>'z'),$post);
}
setup_case();
$result=jetron_admin_handle_post();
$data=jetron_admin_load();
check($result[0]==='ok','unset checkbox succeeds');
check(array_column($data['fonts'],'id')===array('rpl','a','z'),'false sorts into club group');
$byId=array_column($data['fonts'],null,'id');
check($byId['z']['cyrillic']===false,'stores Boolean false');
$original=fixture(); $expected=$original['fonts'][1]; $expected['cyrillic']=false;
check($byId['z']===$expected,'only target flag changes, including unknown fields');
check($byId['rpl']===$original['fonts'][0] && $byId['a']===$original['fonts'][2],'other fonts unchanged');
unset($data['fonts'],$original['fonts']);
check($data===$original,'all other config sections unchanged');
$_POST['font_cyrillic']='1';
check(jetron_admin_handle_post()[0]==='ok','checked succeeds');
$data=jetron_admin_load();
check(array_column($data['fonts'],'id')===array('rpl','z','a'),'true sorts into Cyrillic group');
check($data['fonts'][1]['cyrillic']===true,'stores Boolean true');

$cases=array(
    'unknown'=>array('font_id'=>'missing'), 'empty'=>array('font_id'=>''),
    'array id'=>array('font_id'=>array('z')), 'numeric id'=>array('font_id'=>123),
    'array flag'=>array('font_cyrillic'=>array('1')), 'invalid flag'=>array('font_cyrillic'=>'yes'),
    'zero flag'=>array('font_cyrillic'=>'0'), 'integer flag'=>array('font_cyrillic'=>1),
    'null flag'=>array('font_cyrillic'=>null),
    'array nonce'=>array('_wpnonce'=>array('test')),
);
foreach ($cases as $name=>$post) {
    setup_case($post); $before=file_get_contents(jetron_admin_file_path());
    check(jetron_admin_handle_post()[0]==='error', $name.' rejected');
    check($saveCalls===0 && file_get_contents(jetron_admin_file_path())===$before,$name.' never writes');
}
foreach (array('rights','nonce','missing nonce') as $guard) {
    setup_case();
    if ($guard==='rights') $allowed=false;
    if ($guard==='nonce') $validNonce=false;
    if ($guard==='missing nonce') unset($_POST['_wpnonce']);
    check(jetron_admin_handle_post()[0]==='error',$guard.' rejected');
    check($saveCalls===0,$guard.' never writes');
}
foreach (array('{broken','[]','null','{"fonts":"broken"}','{"fonts":null}','{"fonts":[7]}') as $bad) {
    setup_case(); file_put_contents(jetron_admin_file_path(),$bad);
    check(jetron_admin_handle_post()[0]==='error','corrupt config rejected: '.$bad);
    check($saveCalls===0 && file_get_contents(jetron_admin_file_path())===$bad,'corrupt config preserved');
}
setup_case(); $data=fixture(); $data['fonts'][]=$data['fonts'][1];
file_put_contents(jetron_admin_file_path(),json_encode($data));
check(jetron_admin_handle_post()[0]==='error' && $saveCalls===0,'duplicate id never writes');

setup_case(); $data=fixture(); unset($data['fonts']);
file_put_contents(jetron_admin_file_path(),json_encode($data));
file_put_contents(ABSPATH.'constructor/src/config/mock-config.json',json_encode(fixture()));
check(jetron_admin_handle_post()[0]==='ok','base fonts fallback');
$saved=jetron_admin_load();
check(count($saved['fonts'])===3 && $saved['prices']===$data['prices'],'fallback preserves config');
setup_case(); unlink(jetron_admin_file_path());
check(jetron_admin_handle_post()[0]==='ok','missing admin config uses base fonts');
check(count(jetron_admin_load()['fonts'])===3,'missing config saves full base list');
setup_case(); $before=file_get_contents(jetron_admin_file_path()); $failSave=true;
check(jetron_admin_handle_post()[0]==='error','write failure visible');
check(file_get_contents(jetron_admin_file_path())===$before,'failed write keeps existing content');

setup_case();
ob_start(); jetron_admin_tab_fonts(fixture(),'test'); $html=ob_get_clean();
check(substr_count($html,'value="font_update"')===3,'one edit form per font');
check(substr_count($html,'aria-label="Поддерживает кириллицу:')===3,'accessible named checkboxes');
preg_match_all('/<\/?form\b[^>]*>/i',$html,$matches);
$depth=0;
foreach($matches[0] as $tag) {
    $depth += strpos($tag,'</')===0 ? -1 : 1;
    check($depth>=0 && $depth<=1,'forms not nested');
}
check($depth===0,'forms balanced');
check(strpos($html,'value="font_del"')!==false && strpos($html,'value="font_add"')!==false,'existing actions preserved');
echo "PASS: $count checks\n";
