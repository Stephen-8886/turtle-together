using System;
using System.IO;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Drawing;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

class TurtleWindow : Form {
    const string Origin="http://127.0.0.1:47831";
    static string root=AppDomain.CurrentDomain.BaseDirectory;
    static string data=Environment.GetEnvironmentVariable("TURTLE_CLIENT_DATA_DIR")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"TurtleTogether");
    static string config=Path.Combine(data,"server.txt");
    static Process host;
    WebView2 web=new WebView2();
    CoreWebView2Environment environment;
    string backend;
    [STAThread] static void Main(){
        bool created;using(var mutex=new Mutex(true,"Local\\TurtleTogetherClient",out created)){
            if(!created){MessageBox.Show("龟龟客户端已经打开。","龟龟同频");return;}
            Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
            Directory.CreateDirectory(data);if(!File.Exists(config))File.WriteAllText(config,"http://127.0.0.1:4173",new UTF8Encoding(false));
            try{CoreWebView2Environment.GetAvailableBrowserVersionString();Application.Run(new TurtleWindow(true));}
            catch(Exception e){MessageBox.Show("客户端启动失败："+e.Message+"\n请确认已安装 Microsoft Edge WebView2 Runtime。\nhttps://developer.microsoft.com/microsoft-edge/webview2/","龟龟同频");}
            finally{if(host!=null&&!host.HasExited)host.Kill();}
        }
    }
    public TurtleWindow(bool main){
        Text="龟龟同频";Width=470;Height=930;MinimumSize=new Size(350,650);BackColor=Color.FromArgb(250,249,243);
        if(Environment.GetEnvironmentVariable("TURTLE_CLIENT_TEST_HIDDEN")=="1"){Opacity=0;ShowInTaskbar=false;}
        web.Dock=DockStyle.Fill;Controls.Add(web);var menu=new MenuStrip();
        if(main){menu.Items.Add("服务器设置",null,(s,e)=>Settings());menu.Items.Add("重新同步",null,(s,e)=>web.Reload());}
        menu.Items.Add("保存为 PDF / 打印",null,(s,e)=>{if(web.CoreWebView2!=null)web.CoreWebView2.ShowPrintUI();});Controls.Add(menu);MainMenuStrip=menu;
        if(main)Shown+=async(s,e)=>await Start();
    }
    async Task Start(){
        try{
            backend=File.ReadAllText(config).Trim();Uri remote;
            if(!Uri.TryCreate(backend,UriKind.Absolute,out remote)||remote.UserInfo!=""||remote.AbsolutePath!="/"||remote.Query!=""||remote.Fragment!=""||!(remote.Scheme=="https"||(remote.Scheme=="http"&&(remote.Host=="127.0.0.1"||remote.Host=="localhost"))))throw new Exception("请输入 HTTPS 根地址；本机调试可用 http://127.0.0.1:4173。");
            if(host!=null&&!host.HasExited){host.Kill();host.WaitForExit(3000);}
            host=Process.Start(new ProcessStartInfo{FileName=Path.Combine(root,"runtime","node.exe"),Arguments="\""+Path.Combine(root,"client-host.mjs")+"\" \""+config+"\"",WorkingDirectory=root,UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
            await Task.Delay(500);if(host.HasExited)throw new Exception("客户端端口已占用，或服务器地址配置无效。");
            string profile;using(var sha=SHA256.Create()){profile=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(backend))).Replace("-","").Substring(0,16);}
            environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(data,"profiles",profile));
            await Configure(web);web.Source=new Uri(Origin+"/");
        }catch(Exception e){MessageBox.Show(this,e.Message,"无法连接龟龟");Settings();}
    }
    async Task Configure(WebView2 view){
        await view.EnsureCoreWebView2Async(environment);var core=view.CoreWebView2;
        core.Settings.AreDevToolsEnabled=false;core.Settings.AreHostObjectsAllowed=false;core.Settings.IsPasswordAutosaveEnabled=false;
        core.NavigationStarting+=(s,e)=>{Uri uri;if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out uri)||uri.GetLeftPart(UriPartial.Authority)!=Origin)e.Cancel=true;};
        core.PermissionRequested+=(s,e)=>{e.State=CoreWebView2PermissionState.Deny;if(e.Uri.StartsWith(Origin+"/")&&(e.PermissionKind==CoreWebView2PermissionKind.Microphone||e.PermissionKind==CoreWebView2PermissionKind.Notifications))e.State=MessageBox.Show(this,e.PermissionKind==CoreWebView2PermissionKind.Microphone?"允许龟龟使用麦克风录制聊天语音？":"允许龟龟显示督促通知？","龟龟同频",MessageBoxButtons.YesNo)==DialogResult.Yes?CoreWebView2PermissionState.Allow:CoreWebView2PermissionState.Deny;};
        core.NewWindowRequested+=async(s,e)=>{e.Handled=true;Uri uri;if(!e.IsUserInitiated||!Uri.TryCreate(e.Uri,UriKind.Absolute,out uri)||uri.GetLeftPart(UriPartial.Authority)!=Origin)return;try{var child=new TurtleWindow(false);child.environment=environment;child.Show(this);await child.Configure(child.web);child.web.Source=uri;}catch(Exception error){File.AppendAllText(Path.Combine(data,"client-errors.log"),error.ToString()+Environment.NewLine);MessageBox.Show(this,"无法打开导出窗口："+error.Message,"龟龟同频");}};
    }
    void Settings(){
        using(var form=new Form{Text="服务器设置",Width=460,Height=200,StartPosition=FormStartPosition.CenterParent}){
            var label=new Label{Text="本地后端：http://127.0.0.1:4173\n联网使用时填写 HTTPS 服务器根地址。",Left=16,Top=14,Width=420,Height=45};
            var input=new TextBox{Text=File.ReadAllText(config).Trim(),Left=16,Top=65,Width=410};var save=new Button{Text="保存并重启客户端",Left=230,Top=105,Width=196};
            save.Click+=(s,e)=>{Uri uri;string value=input.Text.Trim();if(!Uri.TryCreate(value,UriKind.Absolute,out uri)||uri.UserInfo!=""||uri.AbsolutePath!="/"||uri.Query!=""||uri.Fragment!=""||!(uri.Scheme=="https"||(uri.Scheme=="http"&&(uri.Host=="127.0.0.1"||uri.Host=="localhost")))){MessageBox.Show(form,"请输入 HTTPS 根地址，或本机 http://127.0.0.1:4173。");return;}File.WriteAllText(config,uri.GetLeftPart(UriPartial.Authority),new UTF8Encoding(false));form.Close();Application.Restart();Application.Exit();};
            form.Controls.AddRange(new Control[]{label,input,save});form.ShowDialog(this);
        }
    }
}
