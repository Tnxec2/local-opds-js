

export type Xteink = {
    enableGrayscale: boolean;
    coverWidth: number | undefined;
    coverHeight: number | undefined;
}

export function getXteinkConfig(format: string | null): Xteink {
    switch (format) {
        case 'x4':
            return {
                enableGrayscale: true,
                coverWidth: 480,
                coverHeight: 800,
            };
        case 'x3':
            return {
                enableGrayscale: true,
                coverWidth: 528,
                coverHeight: 792,
            };
        default:
            return {
                enableGrayscale: true,
                coverWidth: 1200,
                coverHeight: 1600,
            };
    }
    
}