import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;
import java.util.Enumeration;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Signs an unsigned APK with a v2 signature (Android 7+, so v1 is not needed) using apksig, then verifies it
 * and checks that uncompressed entries are 4-byte aligned (what zipalign does).
 *
 * Usage: java -cp apksig.jar:. SignApk in.apk out.apk keystore.jks storePass alias keyPass minSdk
 */
public class SignApk {
  public static void main(String[] args) throws Exception {
    File in = new File(args[1] + ".aligned");
    align(new File(args[0]), in);
    File out = new File(args[1]);
    KeyStore ks = KeyStore.getInstance("PKCS12");
    try (FileInputStream fis = new FileInputStream(args[2])) {
      ks.load(fis, args[3].toCharArray());
    }
    PrivateKey key = (PrivateKey) ks.getKey(args[4], args[5].toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate(args[4]);
    ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("BLOOMORA", key, Collections.singletonList(cert)).build();
    new ApkSigner.Builder(Collections.singletonList(signer))
        .setInputApk(in)
        .setOutputApk(out)
        .setMinSdkVersion(Integer.parseInt(args[6]))
        .setV1SigningEnabled(false)
        .setV2SigningEnabled(true)
        .build()
        .sign();

    ApkVerifier.Result result = new ApkVerifier.Builder(out).build().verify();
    if (!result.isVerified()) {
      System.err.println("Verification failed: " + result.getErrors());
      System.exit(1);
    }
    System.out.println("Signed and verified (v1=" + result.isVerifiedUsingV1Scheme() + ", v2=" + result.isVerifiedUsingV2Scheme() + ")");
    checkAlignment(out);
    in.delete();
  }

  /** Counts bytes written so local header offsets are known. */
  private static final class CountingStream extends FilterOutputStream {
    long count;
    CountingStream(OutputStream out) { super(out); }
    @Override public void write(int b) throws IOException { out.write(b); count++; }
    @Override public void write(byte[] b, int off, int len) throws IOException { out.write(b, off, len); count += len; }
  }

  /** Rewrites the zip so every STORED entry's data starts on a 4-byte boundary. */
  private static void align(File input, File output) throws IOException {
    try (ZipFile zip = new ZipFile(input);
         CountingStream counter = new CountingStream(new FileOutputStream(output));
         ZipOutputStream zos = new ZipOutputStream(counter)) {
      Enumeration<? extends ZipEntry> entries = zip.entries();
      byte[] buffer = new byte[65536];
      while (entries.hasMoreElements()) {
        ZipEntry source = entries.nextElement();
        byte[] data = readAll(zip.getInputStream(source), buffer);
        ZipEntry entry = new ZipEntry(source.getName());
        entry.setTime(source.getTime());
        if (source.getMethod() == ZipEntry.STORED) {
          CRC32 crc = new CRC32();
          crc.update(data);
          entry.setMethod(ZipEntry.STORED);
          entry.setSize(data.length);
          entry.setCompressedSize(data.length);
          entry.setCrc(crc.getValue());
          int nameLength = source.getName().getBytes(StandardCharsets.UTF_8).length;
          long dataStart = counter.count + 30 + nameLength + 6;
          int padding = (int) ((4 - (dataStart % 4)) % 4);
          // Android's zipalign extra field: id 0xD935, alignment, then zero padding.
          byte[] extra = new byte[6 + padding];
          extra[0] = (byte) 0x35; extra[1] = (byte) 0xD9;
          extra[2] = (byte) (2 + padding); extra[3] = 0;
          extra[4] = 4; extra[5] = 0;
          entry.setExtra(extra);
        } else {
          entry.setMethod(ZipEntry.DEFLATED);
        }
        zos.putNextEntry(entry);
        zos.write(data);
        zos.closeEntry();
      }
    }
  }

  private static byte[] readAll(InputStream in, byte[] buffer) throws IOException {
    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
    int read;
    while ((read = in.read(buffer)) != -1) bytes.write(buffer, 0, read);
    in.close();
    return bytes.toByteArray();
  }

  /** Reads the central directory and fails if a STORED entry's data is not 4-byte aligned. */
  private static void checkAlignment(File apk) throws Exception {
    try (RandomAccessFile raf = new RandomAccessFile(apk, "r")) {
      long eocd = raf.length() - 22;
      while (eocd >= 0) {
        raf.seek(eocd);
        if (Integer.reverseBytes(raf.readInt()) == 0x06054b50) break;
        eocd--;
      }
      if (eocd < 0) throw new IOException("No end of central directory record");
      raf.seek(eocd + 10);
      int count = Short.reverseBytes(raf.readShort()) & 0xffff;
      raf.seek(eocd + 16);
      long pos = Integer.reverseBytes(raf.readInt()) & 0xffffffffL;
      int stored = 0;
      int misaligned = 0;
      for (int i = 0; i < count; i++) {
        raf.seek(pos + 10);
        int method = Short.reverseBytes(raf.readShort()) & 0xffff;
        raf.seek(pos + 28);
        int nameLen = Short.reverseBytes(raf.readShort()) & 0xffff;
        int extraLen = Short.reverseBytes(raf.readShort()) & 0xffff;
        int commentLen = Short.reverseBytes(raf.readShort()) & 0xffff;
        raf.seek(pos + 42);
        long local = Integer.reverseBytes(raf.readInt()) & 0xffffffffL;
        if (method == 0) {
          stored++;
          raf.seek(local + 26);
          int localName = Short.reverseBytes(raf.readShort()) & 0xffff;
          int localExtra = Short.reverseBytes(raf.readShort()) & 0xffff;
          if ((local + 30 + localName + localExtra) % 4 != 0) misaligned++;
        }
        pos += 46 + nameLen + extraLen + commentLen;
      }
      System.out.println("Entries: " + count + ", stored: " + stored + ", misaligned: " + misaligned);
      if (misaligned > 0) System.exit(2);
    }
  }

}
