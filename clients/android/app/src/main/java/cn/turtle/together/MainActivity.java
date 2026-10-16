package cn.turtle.together;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.print.PrintManager;
import android.view.*;
import android.webkit.*;
import android.widget.*;

public class MainActivity extends Activity {
    private WebView web,printView;private LocalServer server;private ValueCallback<Uri[]> files;private PermissionRequest microphone;
    @Override public void onCreate(Bundle state){super.onCreate(state);setTitle("龟龟同频");web=new WebView(this);configure(web);setContentView(web);String url=getPreferences(0).getString("server","");if(url.isEmpty())settings();else start(url);}
    private void configure(WebView view){
        WebSettings s=view.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(true);s.setJavaScriptCanOpenWindowsAutomatically(false);CookieManager.getInstance().setAcceptCookie(true);
        view.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().startsWith(LocalServer.ORIGIN+"/");}});
        view.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){if(files!=null)files.onReceiveValue(null);files=callback;try{Intent i=params.createIntent();i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,1);return true;}catch(Exception e){files=null;return false;}}
            @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{if(!LocalServer.ORIGIN.equals(request.getOrigin().toString().replaceAll("/$",""))){request.deny();return;}boolean audio=false;for(String resource:request.getResources())if(resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE))audio=true;if(!audio){request.deny();return;}microphone=request;if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED){request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});microphone=null;}else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},2);});}
            @Override public boolean onCreateWindow(WebView v,boolean dialog,boolean user,Message result){if(!user)return false;Dialog popup=new Dialog(MainActivity.this);LinearLayout layout=new LinearLayout(MainActivity.this);layout.setOrientation(LinearLayout.VERTICAL);Button print=new Button(MainActivity.this);print.setText("保存为 PDF / 打印");WebView child=new WebView(MainActivity.this);configure(child);printView=child;print.setOnClickListener(x->print(child));layout.addView(print);layout.addView(child,new LinearLayout.LayoutParams(-1,0,1));popup.setContentView(layout);popup.getWindow().setLayout(-1,-1);popup.setOnDismissListener(x->{printView=null;child.destroy();});popup.show();((WebView.WebViewTransport)result.obj).setWebView(child);result.sendToTarget();return true;}
        });
        view.setDownloadListener((url,userAgent,disposition,type,length)->{if(!url.startsWith(LocalServer.ORIGIN+"/api/audio/"))return;try{android.app.DownloadManager.Request r=new android.app.DownloadManager.Request(Uri.parse(url));r.addRequestHeader("Cookie",CookieManager.getInstance().getCookie(url));r.setMimeType(type);r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"turtle-voice-"+System.currentTimeMillis());((android.app.DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(r);Toast.makeText(this,"已开始下载语音",Toast.LENGTH_SHORT).show();}catch(Exception e){Toast.makeText(this,"下载失败，请重试",Toast.LENGTH_SHORT).show();}});
    }
    private void start(String url){try{if(server!=null)server.stop();server=new LocalServer(getAssets(),url);web.loadUrl(LocalServer.ORIGIN+"/");}catch(Exception e){new AlertDialog.Builder(this).setMessage("客户端启动失败："+e.getMessage()).setPositiveButton("返回",(d,w)->finish()).show();}}
    private void settings(){EditText input=new EditText(this);input.setSingleLine();input.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);input.setHint(BuildConfig.DEBUG?"http://192.168.x.x:4173":"https://你的服务器");String old=getPreferences(0).getString("server","");input.setText(old);AlertDialog d=new AlertDialog.Builder(this).setTitle("连接你的龟龟服务器").setMessage("界面已内置在 App 中，任务与计时由这个后端同步。"+(BuildConfig.DEBUG?" 本地测试时填写电脑的局域网地址。":"")).setView(input).setPositiveButton("连接",null).setNegativeButton("取消",(x,w)->{if(old.isEmpty())finish();}).create();d.setOnShowListener(x->d.getButton(-1).setOnClickListener(v->{try{String url=LocalServer.validate(input.getText().toString());Runnable connect=()->{getPreferences(0).edit().putString("server",url).apply();start(url);d.dismiss();};if(!url.equals(old)){WebStorage.getInstance().deleteAllData();CookieManager.getInstance().removeAllCookies(ok->connect.run());}else connect.run();}catch(Exception e){input.setError(e.getMessage());}}));d.show();}
    private void print(WebView view){((PrintManager)getSystemService(PRINT_SERVICE)).print("龟龟同频记录",view.createPrintDocumentAdapter("聊天记录"),null);}
    @Override public boolean onCreateOptionsMenu(Menu menu){menu.add("服务器设置");menu.add("重新同步");menu.add("保存为 PDF / 打印");return true;}
    @Override public boolean onOptionsItemSelected(MenuItem item){String title=item.getTitle().toString();if(title.equals("服务器设置"))settings();else if(title.equals("重新同步"))web.reload();else print(printView==null?web:printView);return true;}
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==1&&files!=null){files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));files=null;}}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==2&&microphone!=null){if(grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)microphone.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else microphone.deny();microphone=null;}}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
    @Override protected void onPause(){super.onPause();CookieManager.getInstance().flush();}
    @Override protected void onDestroy(){if(server!=null)server.stop();web.destroy();super.onDestroy();}
}
