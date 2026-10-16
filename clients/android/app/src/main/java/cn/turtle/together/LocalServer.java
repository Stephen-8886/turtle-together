package cn.turtle.together;

import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import fi.iki.elonen.NanoHTTPD;

final class LocalServer extends NanoHTTPD {
    static final int PORT=47832;
    static final String ORIGIN="http://127.0.0.1:"+PORT;
    private final AssetManager assets;
    private final String backend;
    LocalServer(AssetManager assets,String backend) throws IOException {
        super("127.0.0.1",PORT);this.assets=assets;this.backend=backend;start(SOCKET_READ_TIMEOUT,true);
    }
    static String validate(String input) throws Exception {
        URI uri=new URI(input.trim());String host=uri.getHost(),scheme=uri.getScheme();
        boolean local=host!=null&&(host.equals("localhost")||host.equals("127.0.0.1")||host.startsWith("192.168.")||host.startsWith("10.")||host.matches("172\\.(1[6-9]|2[0-9]|3[01])\\..*"));
        if(host==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals("/"))||!("https".equals(scheme)||(BuildConfig.DEBUG&&"http".equals(scheme)&&local)))throw new Exception("请输入 HTTPS 服务器根地址；本地测试版也支持电脑的局域网 HTTP 地址。");
        return scheme+"://"+uri.getRawAuthority();
    }
    private Response json(Response.Status status,String text){Response r=newFixedLengthResponse(status,"application/json; charset=utf-8","{\"error\":\""+text+"\"}");r.addHeader("Cache-Control","no-store");return r;}
    @Override public Response serve(IHTTPSession session){
        String host=session.getHeaders().get("host"),origin=session.getHeaders().get("origin");
        if(!("127.0.0.1:"+PORT).equals(host)||(origin!=null&&!ORIGIN.equals(origin)))return json(Response.Status.FORBIDDEN,"请求来源不匹配。");
        if(session.getMethod()!=Method.GET&&session.getMethod()!=Method.HEAD&&session.getMethod()!=Method.POST)return json(Response.Status.METHOD_NOT_ALLOWED,"请求方式不支持。");
        String route=session.getUri();
        try {
            if(route.startsWith("/api/"))return proxy(session);
            if(session.getMethod()==Method.POST)return json(Response.Status.METHOD_NOT_ALLOWED,"请求方式不支持。");
            if(route.contains("..")||route.contains("\\")||route.contains("\0"))return json(Response.Status.NOT_FOUND,"页面不存在。");
            String file="public"+(route.equals("/")?"/index.html":route);
            InputStream stream=assets.open(file);String mime=route.endsWith(".js")?"text/javascript":route.endsWith(".css")?"text/css":route.endsWith(".svg")?"image/svg+xml":route.endsWith(".png")?"image/png":route.endsWith(".webmanifest")?"application/manifest+json":"text/html";
            Response r=newChunkedResponse(Response.Status.OK,mime,stream);r.addHeader("Cache-Control","no-cache");r.addHeader("X-Content-Type-Options","nosniff");r.addHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");return r;
        }catch(Exception e){return json(Response.Status.SERVICE_UNAVAILABLE,"无法连接服务器，请检查网络和服务器设置。");}
    }
    private Response proxy(IHTTPSession session) throws Exception {
        String query=session.getQueryParameterString(),route=session.getUri()+(query==null?"":"?"+query);
        HttpURLConnection connection=(HttpURLConnection)new URL(backend+route).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(35000);connection.setRequestMethod(session.getMethod().name());
        for(String key:new String[]{"content-type","cookie","range","accept"})if(session.getHeaders().containsKey(key))connection.setRequestProperty(key,session.getHeaders().get(key));
        if(session.getHeaders().containsKey("origin"))connection.setRequestProperty("Origin",backend);
        if(session.getMethod()==Method.POST){
            long size=Long.parseLong(session.getHeaders().getOrDefault("content-length","0"));if(size>7*1024*1024+20000||size<0)return json(Response.Status.PAYLOAD_TOO_LARGE,"内容太长。");
            Map<String,String> body=new HashMap<>();session.parseBody(body);byte[] bytes=body.getOrDefault("postData","").getBytes(StandardCharsets.UTF_8);connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}
        }
        int code=connection.getResponseCode();InputStream raw=code>=400?connection.getErrorStream():connection.getInputStream();if(raw==null)raw=new ByteArrayInputStream(new byte[0]);
        final HttpURLConnection remote=connection;InputStream stream=new FilterInputStream(raw){@Override public void close()throws IOException{super.close();remote.disconnect();}};
        Response r=newChunkedResponse(new Response.IStatus(){public int getRequestStatus(){return code;}public String getDescription(){return code+" response";}},connection.getContentType(),stream);
        for(String key:new String[]{"Content-Range","Accept-Ranges","Cache-Control","Content-Disposition","Content-Security-Policy"}){String value=connection.getHeaderField(key);if(value!=null)r.addHeader(key,value);}
        String cookie=connection.getHeaderField("Set-Cookie");if(cookie!=null)r.addHeader("Set-Cookie",cookie.replaceAll("(?i);\\s*Secure","").replaceAll("(?i);\\s*Domain=[^;]+",""));
        return r;
    }
}
