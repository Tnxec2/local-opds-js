function bookPassFormat(book, format) {
  const ext = book.relpath.toLowerCase();
  console.log(ext, format)
  if ((format === 'x3') && 
    (ext.endsWith('.x3.fb2.zip')
    ||
    ext.endsWith('.x3.fb2')
    ||
    ext.endsWith('.x3.epub'))
  ) {
    console.log('pass format x3')
    return true;
  } else if (format === 'x4' &&
    (ext.endsWith('.x4.fb2.zip')
    ||
    ext.endsWith('.x4.fb2')
    ||
    ext.endsWith('.x4.epub')
    )
  ) {
    console.log('pass format x4')
    return true;
  } else if (format === '' &&
    (
      (ext.endsWith('.fb2.zip') && !ext.endsWith('.x3.fb2.zip') && !ext.endsWith('.x4.fb2.zip'))
    ||
    (ext.endsWith('.fb2') && !ext.endsWith('.x3.fb2') && !ext.endsWith('.x4.fb2'))
    ||
    (ext.endsWith('.epub') && !ext.endsWith('.x3.epub') && !ext.endsWith('.x4.epub'))
    )
  ) {
    console.log('pass format')
    return true;
  }
  return false;
}

const s = 'test/oleynikov_velkino-detstvo.-5niuw.416445.x3.epub'

console.log(bookPassFormat({ relpath: s }, ''))