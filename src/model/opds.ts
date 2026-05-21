


const getSubseciton = (href: string) => {
    return { type: "application/atom+xml;profile=opds-catalog", rel: 'subsection', href: href }
}

export { getSubseciton }