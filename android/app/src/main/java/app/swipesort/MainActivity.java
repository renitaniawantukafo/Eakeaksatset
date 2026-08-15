package app.swipesort;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Size;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Cangkang WebView untuk SwipeSort dengan jembatan galeri native:
 * membaca MediaStore per bulan, menyajikan thumbnail lewat interceptor,
 * dan menerapkan pindah/hapus foto dengan dialog konfirmasi sistem.
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "appassets.androidx.dev";
    private static final String START_URL = "https://" + APP_HOST + "/assets/index.html";

    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_PERMISSION = 2;
    private static final int REQ_MOVE = 3;
    private static final int REQ_DELETE = 4;

    private static final int BG_COLOR = Color.parseColor("#000000");

    private static final String[] MONTH_NAMES =
            {"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"};

    private static final Map<String, String> MIME_TYPES = new HashMap<>();
    static {
        MIME_TYPES.put("html", "text/html");
        MIME_TYPES.put("css", "text/css");
        MIME_TYPES.put("js", "text/javascript");
        MIME_TYPES.put("json", "application/json");
        MIME_TYPES.put("webmanifest", "application/manifest+json");
        MIME_TYPES.put("svg", "image/svg+xml");
        MIME_TYPES.put("png", "image/png");
        MIME_TYPES.put("jpg", "image/jpeg");
        MIME_TYPES.put("jpeg", "image/jpeg");
        MIME_TYPES.put("webp", "image/webp");
        MIME_TYPES.put("gif", "image/gif");
        MIME_TYPES.put("ico", "image/x-icon");
        MIME_TYPES.put("woff2", "font/woff2");
    }

    private WebView webView;
    private ValueCallback<Uri[]> pendingFileCallback;
    private volatile boolean scanCancelled;
    // Perpindahan yang menunggu persetujuan dialog createWriteRequest
    private List<long[]> pendingMoveIds; // hanya id, album paralel di pendingMoveAlbums
    private List<String> pendingMoveAlbums;
    private List<Long> pendingDeleteIds;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(BG_COLOR);
        getWindow().setNavigationBarColor(BG_COLOR);

        webView = new WebView(this);
        webView.setBackgroundColor(BG_COLOR);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);

        webView.addJavascriptInterface(new GalleryBridge(), "NativeGallery");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (!APP_HOST.equals(url.getHost())) {
                    return null;
                }
                String path = url.getPath() == null ? "" : url.getPath();
                if (path.startsWith("/assets/")) {
                    String assetPath = path.substring("/assets/".length());
                    try {
                        InputStream stream = getAssets().open(assetPath);
                        return new WebResourceResponse(guessMime(assetPath), "utf-8", stream);
                    } catch (IOException e) {
                        return notFound();
                    }
                }
                if (path.startsWith("/media/")) {
                    return serveMedia(url);
                }
                return notFound();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (APP_HOST.equals(request.getUrl().getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                } catch (Exception ignored) {
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(
                            Intent.createChooser(intent, getString(R.string.file_chooser_title)),
                            REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    pendingFileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        webView.loadUrl(START_URL);
    }

    // ================== Jembatan JavaScript ==================

    private class GalleryBridge {

        @JavascriptInterface
        public boolean hasPermission() {
            return checkSelfPermission(readPermission()) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestPermission() {
            runOnUiThread(() -> {
                List<String> perms = new ArrayList<>();
                perms.add(readPermission());
                if (Build.VERSION.SDK_INT <= 29) {
                    perms.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
                }
                requestPermissions(perms.toArray(new String[0]), REQ_PERMISSION);
            });
        }

        /** Daftar bulan: [{key:'2024-05', label:'Mei 2024', count:12}], urut naik. */
        @JavascriptInterface
        public String listMonths() {
            LinkedHashMap<String, Integer> counts = new LinkedHashMap<>();
            try (Cursor c = queryImages(new String[]{
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED}, null, null)) {
                if (c != null) {
                    int iTaken = c.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN);
                    int iAdded = c.getColumnIndex(MediaStore.Images.Media.DATE_ADDED);
                    while (c.moveToNext()) {
                        long ms = bestDate(c.getLong(iTaken), c.getLong(iAdded));
                        String key = monthKey(ms);
                        Integer n = counts.get(key);
                        counts.put(key, n == null ? 1 : n + 1);
                    }
                }
            }
            List<String> keys = new ArrayList<>(counts.keySet());
            java.util.Collections.sort(keys);
            JSONArray out = new JSONArray();
            try {
                for (String key : keys) {
                    JSONObject o = new JSONObject();
                    o.put("key", key);
                    o.put("label", monthLabel(key));
                    o.put("count", counts.get(key));
                    out.put(o);
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        /** Album perangkat: [{name, count, coverId}]. */
        @JavascriptInterface
        public String listAlbums() {
            LinkedHashMap<String, int[]> counts = new LinkedHashMap<>();
            LinkedHashMap<String, Long> covers = new LinkedHashMap<>();
            try (Cursor c = queryImages(new String[]{
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.BUCKET_DISPLAY_NAME}, null,
                    MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        String bucket = c.getString(1);
                        if (bucket == null) bucket = "(Tanpa nama)";
                        int[] n = counts.get(bucket);
                        if (n == null) {
                            counts.put(bucket, new int[]{1});
                            covers.put(bucket, c.getLong(0));
                        } else {
                            n[0]++;
                        }
                    }
                }
            }
            JSONArray out = new JSONArray();
            try {
                for (Map.Entry<String, int[]> e : counts.entrySet()) {
                    JSONObject o = new JSONObject();
                    o.put("name", e.getKey());
                    o.put("count", e.getValue()[0]);
                    o.put("coverId", covers.get(e.getKey()));
                    out.put(o);
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        /** Foto satu bulan, urut waktu naik: [{id, name, taken}]. */
        @JavascriptInterface
        public String listPhotos(String monthKey) {
            List<long[]> rows = new ArrayList<>(); // {id, taken}
            List<String> names = new ArrayList<>();
            try (Cursor c = queryImages(new String[]{
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED}, null, null)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        long ms = bestDate(c.getLong(2), c.getLong(3));
                        if (!monthKey(ms).equals(monthKey)) continue;
                        rows.add(new long[]{c.getLong(0), ms});
                        names.add(c.getString(1));
                    }
                }
            }
            // Urutkan berdasarkan waktu naik (indeks nama ikut)
            Integer[] order = new Integer[rows.size()];
            for (int i = 0; i < order.length; i++) order[i] = i;
            java.util.Arrays.sort(order, (a, b) -> Long.compare(rows.get(a)[1], rows.get(b)[1]));
            JSONArray out = new JSONArray();
            try {
                for (int i : order) {
                    JSONObject o = new JSONObject();
                    o.put("id", rows.get(i)[0]);
                    o.put("name", names.get(i));
                    o.put("taken", rows.get(i)[1]);
                    out.put(o);
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        @JavascriptInterface
        public String listAlbumPhotos(String bucketName) {
            JSONArray out = new JSONArray();
            try (Cursor c = queryImages(new String[]{
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DISPLAY_NAME},
                    MediaStore.Images.Media.BUCKET_DISPLAY_NAME + "=?",
                    MediaStore.Images.Media.DATE_ADDED + " DESC", bucketName)) {
                if (c != null) {
                    while (c.moveToNext()) {
                        JSONObject o = new JSONObject();
                        o.put("id", c.getLong(0));
                        o.put("name", c.getString(1));
                        out.put(o);
                    }
                }
            } catch (Exception ignored) {
            }
            return out.toString();
        }

        /** moves: [{id, album}] — minta persetujuan sistem lalu pindahkan. */
        @JavascriptInterface
        public void commitMoves(String movesJson) {
            try {
                JSONArray arr = new JSONArray(movesJson);
                List<long[]> ids = new ArrayList<>();
                List<String> albums = new ArrayList<>();
                List<Uri> uris = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject o = arr.getJSONObject(i);
                    long id = o.getLong("id");
                    ids.add(new long[]{id});
                    albums.add(o.getString("album"));
                    uris.add(imageUri(id));
                }
                pendingMoveIds = ids;
                pendingMoveAlbums = albums;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.app.PendingIntent pi =
                            MediaStore.createWriteRequest(getContentResolver(), uris);
                    runOnUiThread(() -> {
                        try {
                            startIntentSenderForResult(pi.getIntentSender(), REQ_MOVE, null, 0, 0, 0);
                        } catch (Exception e) {
                            emitMovesDone(false, new ArrayList<>(), 0);
                        }
                    });
                } else {
                    performMoves(); // legacy: izin WRITE sudah cukup
                }
            } catch (Exception e) {
                emitMovesDone(false, new ArrayList<>(), 0);
            }
        }

        /** ids: [id, ...] — hapus lewat dialog sistem (30+) atau langsung (legacy). */
        @JavascriptInterface
        public void commitDeletes(String idsJson) {
            try {
                JSONArray arr = new JSONArray(idsJson);
                List<Long> ids = new ArrayList<>();
                List<Uri> uris = new ArrayList<>();
                for (int i = 0; i < arr.length(); i++) {
                    long id = Long.parseLong(arr.getString(i));
                    ids.add(id);
                    uris.add(imageUri(id));
                }
                pendingDeleteIds = ids;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.app.PendingIntent pi =
                            MediaStore.createDeleteRequest(getContentResolver(), uris);
                    runOnUiThread(() -> {
                        try {
                            startIntentSenderForResult(pi.getIntentSender(), REQ_DELETE, null, 0, 0, 0);
                        } catch (Exception e) {
                            emitDeletesDone(false, new ArrayList<>());
                        }
                    });
                } else {
                    ContentResolver resolver = getContentResolver();
                    List<Long> deleted = new ArrayList<>();
                    for (Long id : ids) {
                        try {
                            if (resolver.delete(imageUri(id), null, null) > 0) deleted.add(id);
                        } catch (Exception ignored) {
                        }
                    }
                    emitDeletesDone(true, deleted);
                }
            } catch (Exception e) {
                emitDeletesDone(false, new ArrayList<>());
            }
        }

        /**
         * Semua foto galeri dengan tanggalnya, terbaru dulu (untuk pemindaian
         * wajah & pengelompokan hasil per bulan): [{id, taken}, ...].
         */
        @JavascriptInterface
        public String listAllIds() {
            JSONArray out = new JSONArray();
            try (Cursor c = queryImages(new String[]{
                    MediaStore.Images.Media._ID,
                    MediaStore.Images.Media.DATE_TAKEN,
                    MediaStore.Images.Media.DATE_ADDED}, null,
                    MediaStore.Images.Media.DATE_ADDED + " DESC")) {
                if (c != null) {
                    while (c.moveToNext()) {
                        try {
                            JSONObject o = new JSONObject();
                            o.put("id", c.getLong(0));
                            o.put("taken", bestDate(c.getLong(1), c.getLong(2)));
                            out.put(o);
                        } catch (Exception ignored) {
                        }
                    }
                }
            }
            return out.toString();
        }

        /**
         * Pindai wajah untuk id yang diberikan, di thread latar.
         * Hasil dikirim bertahap lewat event ng-face-batch {results:[{id,faces}]},
         * lalu ng-face-done {cancelled} saat selesai/dihentikan.
         */
        @JavascriptInterface
        public void scanFaces(String idsJson) {
            final List<Long> ids = new ArrayList<>();
            try {
                JSONArray arr = new JSONArray(idsJson);
                for (int i = 0; i < arr.length(); i++) ids.add(Long.parseLong(arr.getString(i)));
            } catch (Exception e) {
                emitFaceDone(false);
                return;
            }
            scanCancelled = false;
            new Thread(() -> {
                JSONArray batch = new JSONArray();
                try {
                    for (Long id : ids) {
                        if (scanCancelled) break;
                        int faces = countFaces(id);
                        JSONObject o = new JSONObject();
                        o.put("id", id);
                        o.put("faces", faces);
                        batch.put(o);
                        if (batch.length() >= 8) {
                            emitFaceBatch(batch);
                            batch = new JSONArray();
                        }
                    }
                    if (batch.length() > 0) emitFaceBatch(batch);
                } catch (Exception ignored) {
                }
                emitFaceDone(scanCancelled);
            }, "face-scan").start();
        }

        @JavascriptInterface
        public void cancelScan() {
            scanCancelled = true;
        }

        @JavascriptInterface
        public void share(String id) {
            try {
                Uri uri = imageUri(Long.parseLong(id));
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType("image/*");
                send.putExtra(Intent.EXTRA_STREAM, uri);
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send, getString(R.string.share_title)));
            } catch (Exception ignored) {
            }
        }
    }

    // ================== Eksekusi pindah/hapus ==================

    /** Jalankan perpindahan yang tertunda (setelah persetujuan pada API 30+). */
    private void performMoves() {
        new Thread(() -> {
            List<Long> moved = new ArrayList<>();
            int failed = 0;
            for (int i = 0; i < pendingMoveIds.size(); i++) {
                long id = pendingMoveIds.get(i)[0];
                String album = pendingMoveAlbums.get(i);
                boolean ok;
                if (Build.VERSION.SDK_INT >= 30) {
                    ok = moveModern(id, album);
                } else {
                    ok = moveLegacy(id, album);
                }
                if (ok) moved.add(id);
                else failed++;
            }
            emitMovesDone(true, moved, failed);
        }).start();
    }

    /** API 30+: perbarui RELATIVE_PATH — MediaStore memindahkan berkasnya. */
    private boolean moveModern(long id, String album) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Images.Media.RELATIVE_PATH, relativePathFor(album));
            return getContentResolver().update(imageUri(id), values, null, null) > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** Cari folder album yang sudah ada; kalau tidak ada pakai Pictures/<album>/. */
    private String relativePathFor(String album) {
        try (Cursor c = queryImages(new String[]{MediaStore.Images.Media.RELATIVE_PATH},
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME + "=?", null, album)) {
            if (c != null && c.moveToFirst()) {
                String path = c.getString(0);
                if (path != null && !path.isEmpty()) return path;
            }
        } catch (Exception ignored) {
        }
        return Environment.DIRECTORY_PICTURES + "/" + album + "/";
    }

    /** API ≤29 (legacy storage): pindahkan berkas langsung lalu pindai ulang. */
    private boolean moveLegacy(long id, String album) {
        try {
            String data = null;
            try (Cursor c = queryImages(new String[]{MediaStore.Images.Media.DATA},
                    MediaStore.Images.Media._ID + "=?", null, String.valueOf(id))) {
                if (c != null && c.moveToFirst()) data = c.getString(0);
            }
            if (data == null) return false;
            File src = new File(data);
            File dir = legacyAlbumDir(album);
            if (!dir.exists() && !dir.mkdirs()) return false;
            File dst = new File(dir, src.getName());
            int n = 1;
            while (dst.exists()) {
                String base = src.getName();
                int dot = base.lastIndexOf('.');
                String stem = dot > 0 ? base.substring(0, dot) : base;
                String ext = dot > 0 ? base.substring(dot) : "";
                dst = new File(dir, stem + "_" + (n++) + ext);
            }
            if (!src.renameTo(dst)) return false;
            getContentResolver().delete(imageUri(id), null, null);
            MediaScannerConnection.scanFile(this, new String[]{dst.getAbsolutePath()}, null, null);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private File legacyAlbumDir(String album) {
        try (Cursor c = queryImages(new String[]{MediaStore.Images.Media.DATA},
                MediaStore.Images.Media.BUCKET_DISPLAY_NAME + "=?", null, album)) {
            if (c != null && c.moveToFirst()) {
                File parent = new File(c.getString(0)).getParentFile();
                if (parent != null) return parent;
            }
        } catch (Exception ignored) {
        }
        return new File(Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_PICTURES), album);
    }

    // ================== Deteksi wajah ==================

    /**
     * Hitung wajah pada satu foto memakai android.media.FaceDetector bawaan
     * (offline, tanpa dependensi). Butuh bitmap RGB_565 dengan lebar genap.
     */
    private int countFaces(long id) {
        Bitmap thumb = null;
        Bitmap rgb565 = null;
        try {
            Uri uri = imageUri(id);
            if (Build.VERSION.SDK_INT >= 29) {
                thumb = getContentResolver().loadThumbnail(uri, new Size(512, 512), null);
            } else {
                thumb = MediaStore.Images.Thumbnails.getThumbnail(
                        getContentResolver(), id, MediaStore.Images.Thumbnails.MINI_KIND, null);
            }
            if (thumb == null) return 0;
            int w = thumb.getWidth() & ~1; // lebar wajib genap untuk FaceDetector
            int h = thumb.getHeight();
            if (w < 32 || h < 32) return 0;
            rgb565 = Bitmap.createBitmap(w, h, Bitmap.Config.RGB_565);
            android.graphics.Canvas canvas = new android.graphics.Canvas(rgb565);
            canvas.drawBitmap(thumb, 0, 0, null);
            android.media.FaceDetector detector = new android.media.FaceDetector(w, h, 5);
            android.media.FaceDetector.Face[] faces = new android.media.FaceDetector.Face[5];
            return detector.findFaces(rgb565, faces);
        } catch (Exception e) {
            return 0;
        } finally {
            if (rgb565 != null) rgb565.recycle();
            if (thumb != null) thumb.recycle();
        }
    }

    private void emitFaceBatch(JSONArray results) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("results", results);
            emitEvent("ng-face-batch", detail);
        } catch (Exception ignored) {
        }
    }

    private void emitFaceDone(boolean cancelled) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("cancelled", cancelled);
            emitEvent("ng-face-done", detail);
        } catch (Exception ignored) {
        }
    }

    // ================== Event ke JavaScript ==================

    private void emitMovesDone(boolean ok, List<Long> moved, int failed) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("ok", ok);
            detail.put("failed", failed);
            JSONArray arr = new JSONArray();
            for (Long id : moved) arr.put(id);
            detail.put("moved", arr);
            emitEvent("ng-moves-done", detail);
        } catch (Exception ignored) {
        }
    }

    private void emitDeletesDone(boolean ok, List<Long> deleted) {
        try {
            JSONObject detail = new JSONObject();
            detail.put("ok", ok);
            JSONArray arr = new JSONArray();
            for (Long id : deleted) arr.put(id);
            detail.put("deleted", arr);
            emitEvent("ng-deletes-done", detail);
        } catch (Exception ignored) {
        }
    }

    private void emitEvent(String name, JSONObject detail) {
        String js = "window.dispatchEvent(new CustomEvent('" + name + "',{detail:" + detail + "}))";
        runOnUiThread(() -> webView.evaluateJavascript(js, null));
    }

    // ================== Hasil aktivitas & izin ==================

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        switch (requestCode) {
            case REQ_FILE_CHOOSER: {
                if (pendingFileCallback == null) return;
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        ArrayList<Uri> uris = new ArrayList<>(count);
                        for (int i = 0; i < count; i++) {
                            Uri uri = data.getClipData().getItemAt(i).getUri();
                            if (uri != null) uris.add(uri);
                        }
                        results = uris.toArray(new Uri[0]);
                    } else if (data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    }
                }
                pendingFileCallback.onReceiveValue(results);
                pendingFileCallback = null;
                return;
            }
            case REQ_MOVE: {
                if (resultCode == RESULT_OK) performMoves();
                else emitMovesDone(false, new ArrayList<>(), 0);
                return;
            }
            case REQ_DELETE: {
                // Pada API 30+, sistem sudah menghapus berkas saat pengguna menyetujui
                if (resultCode == RESULT_OK) emitDeletesDone(true, pendingDeleteIds);
                else emitDeletesDone(false, new ArrayList<>());
                return;
            }
            default:
                super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_PERMISSION) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            try {
                JSONObject detail = new JSONObject();
                detail.put("granted", granted);
                emitEvent("ng-permission", detail);
            } catch (Exception ignored) {
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    // ================== Penyaji media & util ==================

    /** /media/<id>?w=<px> → thumbnail JPEG; tanpa w → berkas asli. */
    private WebResourceResponse serveMedia(Uri url) {
        try {
            String idStr = url.getPath().substring("/media/".length());
            long id = Long.parseLong(idStr);
            Uri contentUri = imageUri(id);
            String w = url.getQueryParameter("w");
            if (w != null) {
                int size = Math.max(64, Math.min(2048, Integer.parseInt(w)));
                Bitmap bmp;
                if (Build.VERSION.SDK_INT >= 29) {
                    bmp = getContentResolver().loadThumbnail(contentUri, new Size(size, size), null);
                } else {
                    bmp = MediaStore.Images.Thumbnails.getThumbnail(
                            getContentResolver(), id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                }
                if (bmp == null) return notFound();
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 85, buf);
                bmp.recycle();
                return new WebResourceResponse("image/jpeg", null,
                        new ByteArrayInputStream(buf.toByteArray()));
            }
            String mime = "image/jpeg";
            try (Cursor c = getContentResolver().query(contentUri,
                    new String[]{MediaStore.Images.Media.MIME_TYPE}, null, null, null)) {
                if (c != null && c.moveToFirst() && c.getString(0) != null) mime = c.getString(0);
            }
            InputStream stream = getContentResolver().openInputStream(contentUri);
            if (stream == null) return notFound();
            return new WebResourceResponse(mime, null, stream);
        } catch (Exception e) {
            return notFound();
        }
    }

    private Cursor queryImages(String[] projection, String selection, String sortOrder, String... args) {
        return getContentResolver().query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection, selection, args.length > 0 ? args : null, sortOrder);
    }

    private static Uri imageUri(long id) {
        return ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id);
    }

    private static String readPermission() {
        return Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.READ_MEDIA_IMAGES
                : Manifest.permission.READ_EXTERNAL_STORAGE;
    }

    private static long bestDate(long taken, long addedSeconds) {
        if (taken > 0) return taken;
        return addedSeconds > 0 ? addedSeconds * 1000L : System.currentTimeMillis();
    }

    private static String monthKey(long ms) {
        Calendar cal = Calendar.getInstance();
        cal.setTimeInMillis(ms);
        return String.format(Locale.US, "%04d-%02d",
                cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1);
    }

    private static String monthLabel(String key) {
        String[] parts = key.split("-");
        int month = Integer.parseInt(parts[1]);
        return MONTH_NAMES[month - 1] + " " + parts[0];
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                new HashMap<>(),
                new ByteArrayInputStream("Not Found".getBytes(StandardCharsets.UTF_8)));
    }

    private static String guessMime(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot >= 0 ? path.substring(dot + 1).toLowerCase(Locale.US) : "";
        String mime = MIME_TYPES.get(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
